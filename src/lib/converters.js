import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const A4 = [595.28, 841.89];
const MIME_BY_FORMAT = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function formatBytes(value = 0) {
  if (!value) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** exponent;
  return `${amount.toFixed(amount >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function splitFileName(name) {
  const safeName = name || 'file';
  const extensionIndex = safeName.lastIndexOf('.');

  if (extensionIndex <= 0) {
    return {
      baseName: safeName,
      extension: '',
    };
  }

  return {
    baseName: safeName.slice(0, extensionIndex),
    extension: safeName.slice(extensionIndex + 1),
  };
}

function replaceExtension(name, extension) {
  const { baseName } = splitFileName(name);
  return extension ? `${baseName}.${extension}` : baseName;
}

function createUniqueEntryName(name, usedNames) {
  const extensionIndex = name.lastIndexOf('.');
  const baseName = extensionIndex >= 0 ? name.slice(0, extensionIndex) : name;
  const extension = extensionIndex >= 0 ? name.slice(extensionIndex) : '';

  let nextName = name;
  let counter = 2;
  while (usedNames.has(nextName.toLowerCase())) {
    nextName = `${baseName}-${counter}${extension}`;
    counter += 1;
  }

  usedNames.add(nextName.toLowerCase());
  return nextName;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error('Could not create output file.'));
    }, type, quality);
  });
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load image.'));
    image.src = source;
  });
}

async function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(blob);
  });
}

async function optimizeImage(file, { format = 'jpeg', quality = 0.82, maxDimension = 2200 } = {}) {
  const sourceUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(sourceUrl);
    const longestSide = Math.max(image.width, image.height);
    const ratio = longestSide > maxDimension ? maxDimension / longestSide : 1;
    const width = Math.max(1, Math.round(image.width * ratio));
    const height = Math.max(1, Math.round(image.height * ratio));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const safeFormat = format === 'original' ? (file.type.split('/')?.[1] || 'png') : format;
    const mimeType = MIME_BY_FORMAT[safeFormat] || file.type || 'image/png';

    if (!context) {
      throw new Error('Could not prepare canvas.');
    }

    canvas.width = width;
    canvas.height = height;
    if (mimeType === 'image/jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, mimeType, mimeType === 'image/png' ? undefined : quality);

    return {
      blob,
      width,
      height,
      extension: mimeType.split('/')[1] === 'jpeg' ? 'jpg' : mimeType.split('/')[1],
      mimeType,
      originalName: file.name,
      originalSize: file.size,
    };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

async function loadPdf(file) {
  const bytes = await file.arrayBuffer();
  return pdfjsLib.getDocument({ data: bytes }).promise;
}

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function zipAndDownload(entries, zipName) {
  const zip = new JSZip();
  const usedNames = new Set();
  entries.forEach(({ name, blob }) => zip.file(createUniqueEntryName(name, usedNames), blob));
  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  triggerDownload(zipBlob, zipName);
}

export function parsePageSelection(input, totalPages) {
  if (!input.trim()) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const result = new Set();
  const parts = input.split(',').map((part) => part.trim()).filter(Boolean);

  parts.forEach((part) => {
    if (part.includes('-')) {
      const [startRaw, endRaw] = part.split('-');
      const start = Number(startRaw);
      const end = Number(endRaw);

      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > totalPages) {
        throw new Error(`Invalid page range: ${part}`);
      }

      for (let page = start; page <= end; page += 1) {
        result.add(page);
      }
      return;
    }

    const page = Number(part);
    if (!Number.isInteger(page) || page < 1 || page > totalPages) {
      throw new Error(`Invalid page number: ${part}`);
    }
    result.add(page);
  });

  return [...result].sort((left, right) => left - right);
}

function parseSplitGroups(input, totalPages) {
  if (!input.trim()) {
    return Array.from({ length: totalPages }, (_, index) => [index + 1]);
  }

  return input
    .split(',')
    .map((group) => group.trim())
    .filter(Boolean)
    .map((group) => parsePageSelection(group, totalPages));
}

export async function createPdfFromImages(files, options) {
  if (!files.length) {
    throw new Error('Select at least one image.');
  }

  const createSinglePdf = async (group) => {
    const pdf = await PDFDocument.create();

    for (const file of group) {
      const optimized = await optimizeImage(file, options);
      const bytes = await optimized.blob.arrayBuffer();
      const image = optimized.mimeType === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);

      if (options.pagePreset === 'fit') {
        const page = pdf.addPage([image.width, image.height]);
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      } else {
        const [pageWidth, pageHeight] = A4;
        const margin = 24;
        const scale = Math.min((pageWidth - margin * 2) / image.width, (pageHeight - margin * 2) / image.height);
        const drawWidth = image.width * scale;
        const drawHeight = image.height * scale;
        const page = pdf.addPage(A4);
        page.drawImage(image, {
          x: (pageWidth - drawWidth) / 2,
          y: (pageHeight - drawHeight) / 2,
          width: drawWidth,
          height: drawHeight,
        });
      }
    }

    return new Blob([await pdf.save()], { type: 'application/pdf' });
  };

  if (options.combine) {
    const blob = await createSinglePdf(files);
    return {
      mode: 'single',
      fileName: files.length === 1 ? replaceExtension(files[0].name, 'pdf') : 'images-to-pdf.pdf',
      blob,
    };
  }

  const entries = [];
  for (const file of files) {
    const blob = await createSinglePdf([file]);
    entries.push({ name: replaceExtension(file.name, 'pdf'), blob });
  }

  return {
    mode: 'zip',
    zipName: 'image-pdfs.zip',
    entries,
  };
}

export async function convertPdfToImages(file, options) {
  if (!file) {
    throw new Error('Select a PDF file.');
  }

  const pdf = await loadPdf(file);
  const pages = parsePageSelection(options.pages, pdf.numPages);
  const entries = [];
  const format = options.format;
  const mimeType = MIME_BY_FORMAT[format];
  const extension = format === 'jpeg' ? 'jpg' : format;
  const { baseName } = splitFileName(file.name);

  for (const pageNumber of pages) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: options.scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Could not prepare canvas.');
    }

    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const blob = await canvasToBlob(canvas, mimeType, mimeType === 'image/png' ? undefined : options.quality);
    entries.push({
      name: `${baseName}-page-${String(pageNumber).padStart(2, '0')}.${extension}`,
      blob,
    });
  }

  return entries;
}

export async function mergePdfs(files) {
  if (files.length < 2) {
    throw new Error('Select at least two PDF files to merge.');
  }

  const mergedPdf = await PDFDocument.create();

  for (const file of files) {
    const sourcePdf = await PDFDocument.load(await file.arrayBuffer());
    const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
    pages.forEach((page) => mergedPdf.addPage(page));
  }

  return new Blob([await mergedPdf.save()], { type: 'application/pdf' });
}

export async function splitPdf(file, rangesInput) {
  if (!file) {
    throw new Error('Select a PDF file to split.');
  }

  const sourcePdf = await PDFDocument.load(await file.arrayBuffer());
  const groups = parseSplitGroups(rangesInput, sourcePdf.getPageCount());
  const { baseName } = splitFileName(file.name);
  const entries = [];

  for (const group of groups) {
    const output = await PDFDocument.create();
    const pages = await output.copyPages(sourcePdf, group.map((page) => page - 1));
    pages.forEach((page) => output.addPage(page));
    const rangeLabel = group.length === 1 ? `page-${group[0]}` : `pages-${group[0]}-${group[group.length - 1]}`;
    entries.push({
      name: `${baseName}-${rangeLabel}.pdf`,
      blob: new Blob([await output.save()], { type: 'application/pdf' }),
    });
  }

  return entries;
}

export async function compressPdf(file, options) {
  if (!file) {
    throw new Error('Select a PDF file to compress.');
  }

  const pdf = await loadPdf(file);
  const output = await PDFDocument.create();

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: options.scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Could not prepare canvas.');
    }

    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const imageBlob = await canvasToBlob(canvas, 'image/jpeg', options.quality);
    const imageBytes = await imageBlob.arrayBuffer();
    const embedded = await output.embedJpg(imageBytes);
    const outputPage = output.addPage([embedded.width, embedded.height]);
    outputPage.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
  }

  return new Blob([await output.save()], { type: 'application/pdf' });
}

export async function compressImages(files, options) {
  if (!files.length) {
    throw new Error('Select at least one image.');
  }

  const entries = [];
  for (const file of files) {
    const optimized = await optimizeImage(file, options);
    entries.push({
      name: replaceExtension(optimized.originalName, optimized.extension),
      blob: optimized.blob,
      originalSize: optimized.originalSize,
      compressedSize: optimized.blob.size,
    });
  }

  return entries;
}

export async function downloadResult(result) {
  if (result.mode === 'single') {
    triggerDownload(result.blob, result.fileName);
    return;
  }

  if (result.mode === 'zip') {
    await zipAndDownload(result.entries, result.zipName);
  }
}

export async function downloadEntries(entries, zipName, fallbackName) {
  if (entries.length === 1) {
    triggerDownload(entries[0].blob, entries[0].name || fallbackName);
    return;
  }

  await zipAndDownload(entries, zipName);
}

export async function imageFilePreview(files) {
  return Promise.all(
    files.slice(0, 3).map(async (file) => ({
      name: file.name,
      size: formatBytes(file.size),
      preview: await readBlobAsDataUrl(file),
    })),
  );
}
