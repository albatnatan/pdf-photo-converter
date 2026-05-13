import { useEffect, useMemo, useState } from 'react';
import {
  compressImages,
  compressPdf,
  convertPdfToImages,
  createPdfFromImages,
  downloadEntries,
  downloadResult,
  formatBytes,
  imageFilePreview,
  mergePdfs,
  splitPdf,
} from './lib/converters';

const tabs = [
  { id: 'image-pdf', label: 'Images to PDF' },
  { id: 'pdf-image', label: 'PDF to Images' },
  { id: 'pdf-tools', label: 'PDF Tools' },
  { id: 'compress', label: 'Reduce Size' },
];

function FileSummary({ files, previewImages }) {
  const total = files.reduce((sum, file) => sum + file.size, 0);

  if (!files.length) {
    return <p className="empty-state">No files selected yet.</p>;
  }

  return (
    <div className="file-summary">
      <div className="file-meta">
        <strong>{files.length}</strong>
        <span>{formatBytes(total)}</span>
      </div>
      {previewImages?.length ? (
        <>
          <p className="preview-note">Showing the first {previewImages.length} previews out of {files.length} selected files.</p>
          <div className="preview-grid">
            {previewImages.map((item) => (
              <div key={item.name} className="preview-card">
                <img src={item.preview} alt={item.name} />
                <span>{item.name}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <ul>
          {files.slice(0, 5).map((file) => (
            <li key={`${file.name}-${file.size}`}>{file.name}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OrderedFileList({ files, onMoveUp, onMoveDown, onRemove, onClear, onReorder, description }) {
  const [dragIndex, setDragIndex] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);

  if (!files.length) {
    return null;
  }

  return (
    <div className="ordered-files">
      <div className="ordered-files-header">
        <div>
          <h3>Current order</h3>
          <p>{description} Drag files to reorder them.</p>
        </div>
        <button type="button" className="mini-action danger" onClick={onClear}>Clear all</button>
      </div>
      <div className="ordered-files-list">
        {files.map((file, index) => (
          <div
            key={`${file.name}-${file.size}-${index}`}
            className={`ordered-file-row${dragIndex === index ? ' dragging' : ''}${dropIndex === index && dragIndex !== index ? ' drop-target' : ''}`}
            draggable
            onDragStart={(event) => {
              setDragIndex(index);
              setDropIndex(index);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', String(index));
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDropIndex(index);
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragIndex !== null && dragIndex !== index) {
                onReorder(dragIndex, index);
              }
              setDragIndex(null);
              setDropIndex(null);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setDropIndex(null);
            }}
          >
            <div className="ordered-file-main">
              <span className="ordered-file-index">{index + 1}</span>
              <span className="drag-handle" aria-hidden="true">⋮⋮</span>
              <div className="ordered-file-text">
                <strong>{file.name}</strong>
                <span>{formatBytes(file.size)}</span>
              </div>
            </div>
            <div className="ordered-file-actions">
              <button type="button" className="mini-action" disabled={index === 0} onClick={() => onMoveUp(index)}>↑</button>
              <button type="button" className="mini-action" disabled={index === files.length - 1} onClick={() => onMoveDown(index)}>↓</button>
              <button type="button" className="mini-action danger" onClick={() => onRemove(index)}>Remove</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('image-pdf');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ type: 'info', text: 'Choose a tool to get started.' });

  const [imageFiles, setImageFiles] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const [imagePdfOptions, setImagePdfOptions] = useState({ combine: true, pagePreset: 'a4', format: 'jpeg', quality: 0.78, maxDimension: 1800 });

  const [pdfToImageFile, setPdfToImageFile] = useState(null);
  const [pdfImageOptions, setPdfImageOptions] = useState({ format: 'png', pages: '', scale: 1.5, quality: 0.92 });

  const [mergeFiles, setMergeFiles] = useState([]);
  const [splitFile, setSplitFile] = useState(null);
  const [splitRanges, setSplitRanges] = useState('');

  const [compressPdfFile, setCompressPdfFile] = useState(null);
  const [pdfCompressOptions, setPdfCompressOptions] = useState({ scale: 1.1, quality: 0.65 });
  const [compressImageFilesState, setCompressImageFilesState] = useState([]);
  const [compressImagePreviews, setCompressImagePreviews] = useState([]);
  const [imageCompressOptions, setImageCompressOptions] = useState({ format: 'jpeg', quality: 0.55, maxDimension: 1280 });

  useEffect(() => {
    imageFilePreview(imageFiles).then(setImagePreviews);
  }, [imageFiles]);

  useEffect(() => {
    imageFilePreview(compressImageFilesState).then(setCompressImagePreviews);
  }, [compressImageFilesState]);

  const stats = useMemo(() => ({
    images: imageFiles.length,
    mergePdfs: mergeFiles.length,
    compressImages: compressImageFilesState.length,
  }), [compressImageFilesState.length, imageFiles.length, mergeFiles.length]);

  const appendFiles = (setter) => (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length) {
      setter((current) => [...current, ...selectedFiles]);
    }
    event.target.value = '';
  };

  const moveFile = (setter, index, direction) => {
    setter((current) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }

      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const reorderFiles = (setter, fromIndex, toIndex) => {
    setter((current) => {
      if (fromIndex < 0 || fromIndex >= current.length || toIndex < 0 || toIndex >= current.length || fromIndex === toIndex) {
        return current;
      }

      const next = [...current];
      const [movedItem] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, movedItem);
      return next;
    });
  };

  const removeFileAt = (setter, index) => {
    setter((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const clearFiles = (setter) => {
    setter([]);
  };

  const runTask = async (workingText, successText, task) => {
    setBusy(true);
    setMessage({ type: 'info', text: workingText });
    try {
      const result = await task();
      setMessage({ type: 'success', text: result?.successText || successText });
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Browser PDF toolkit</p>
          <h1>Convert photos and PDFs in one place.</h1>
          <p className="hero-copy">
            Turn images into PDFs, export PDF pages as photos, merge or split PDFs, and reduce file sizes without leaving your browser.
          </p>
        </div>
        <div className="hero-stats">
          <div><strong>{stats.images}</strong><span>Images loaded</span></div>
          <div><strong>{stats.mergePdfs}</strong><span>PDFs ready to merge</span></div>
          <div><strong>{stats.compressImages}</strong><span>Images ready to compress</span></div>
        </div>
      </header>

      <nav className="tab-row">
        {tabs.map((tab) => (
          <button key={tab.id} className={tab.id === activeTab ? 'tab active' : 'tab'} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </nav>

      <div className={`status-banner ${message.type}`}>{message.text}</div>

      {activeTab === 'image-pdf' && (
        <section className="panel-grid">
          <article className="panel">
            <h2>Images to PDF</h2>
            <p>Use photos, screenshots, or scanned images and turn them into one PDF or separate PDFs.</p>
            <label className="picker">
              <span>Add images</span>
              <input type="file" accept="image/*" multiple onChange={appendFiles(setImageFiles)} />
            </label>
            <FileSummary files={imageFiles} previewImages={imagePreviews} />
            <OrderedFileList
              files={imageFiles}
              description="The first image will become the first page when you create one combined PDF."
              onReorder={(fromIndex, toIndex) => reorderFiles(setImageFiles, fromIndex, toIndex)}
              onMoveUp={(index) => moveFile(setImageFiles, index, -1)}
              onMoveDown={(index) => moveFile(setImageFiles, index, 1)}
              onRemove={(index) => removeFileAt(setImageFiles, index)}
              onClear={() => clearFiles(setImageFiles)}
            />
            <div className="field-grid">
              <label><span>Output</span><select value={imagePdfOptions.combine ? 'single' : 'multiple'} onChange={(event) => setImagePdfOptions((current) => ({ ...current, combine: event.target.value === 'single' }))}><option value="single">One combined PDF</option><option value="multiple">One PDF per image</option></select></label>
              <label><span>Page size</span><select value={imagePdfOptions.pagePreset} onChange={(event) => setImagePdfOptions((current) => ({ ...current, pagePreset: event.target.value }))}><option value="a4">A4</option><option value="fit">Fit to image</option></select></label>
              <label><span>Image format</span><select value={imagePdfOptions.format} onChange={(event) => setImagePdfOptions((current) => ({ ...current, format: event.target.value }))}><option value="jpeg">JPEG</option><option value="png">PNG</option></select></label>
              <label><span>Quality {Math.round(imagePdfOptions.quality * 100)}%</span><input type="range" min="0.4" max="1" step="0.05" value={imagePdfOptions.quality} onChange={(event) => setImagePdfOptions((current) => ({ ...current, quality: Number(event.target.value) }))} /></label>
              <label><span>Max side {imagePdfOptions.maxDimension}px</span><input type="range" min="800" max="3000" step="100" value={imagePdfOptions.maxDimension} onChange={(event) => setImagePdfOptions((current) => ({ ...current, maxDimension: Number(event.target.value) }))} /></label>
            </div>
            <button className="action" disabled={busy || !imageFiles.length} onClick={() => runTask('Creating PDF from images...', 'Your PDF download is ready.', async () => { const result = await createPdfFromImages(imageFiles, imagePdfOptions); await downloadResult(result); })}>Create PDF</button>
          </article>
        </section>
      )}

      {activeTab === 'pdf-image' && (
        <section className="panel-grid">
          <article className="panel">
            <h2>PDF to Images</h2>
            <p>Export every page or only selected pages as PNG, JPG, or WebP images.</p>
            <label className="picker">
              <span>Select PDF</span>
              <input type="file" accept="application/pdf" onChange={(event) => setPdfToImageFile(event.target.files?.[0] || null)} />
            </label>
            <FileSummary files={pdfToImageFile ? [pdfToImageFile] : []} />
            <div className="field-grid">
              <label><span>Format</span><select value={pdfImageOptions.format} onChange={(event) => setPdfImageOptions((current) => ({ ...current, format: event.target.value }))}><option value="png">PNG</option><option value="jpeg">JPG</option><option value="webp">WebP</option></select></label>
              <label><span>Pages</span><input type="text" value={pdfImageOptions.pages} placeholder="All pages or 1,3-5" onChange={(event) => setPdfImageOptions((current) => ({ ...current, pages: event.target.value }))} /></label>
              <label><span>Scale {pdfImageOptions.scale.toFixed(1)}x</span><input type="range" min="1" max="2.5" step="0.1" value={pdfImageOptions.scale} onChange={(event) => setPdfImageOptions((current) => ({ ...current, scale: Number(event.target.value) }))} /></label>
              <label><span>Quality {Math.round(pdfImageOptions.quality * 100)}%</span><input type="range" min="0.4" max="1" step="0.05" value={pdfImageOptions.quality} onChange={(event) => setPdfImageOptions((current) => ({ ...current, quality: Number(event.target.value) }))} /></label>
            </div>
            <button className="action" disabled={busy || !pdfToImageFile} onClick={() => runTask('Rendering PDF pages as images...', 'Your image export is ready.', async () => { const entries = await convertPdfToImages(pdfToImageFile, pdfImageOptions); await downloadEntries(entries, 'pdf-pages.zip', 'page-image.png'); })}>Export Images</button>
          </article>
        </section>
      )}

      {activeTab === 'pdf-tools' && (
        <section className="panel-grid two-up">
          <article className="panel">
            <h2>Merge PDFs</h2>
            <p>Combine many PDF files into a single document.</p>
            <label className="picker">
              <span>Add PDFs</span>
              <input type="file" accept="application/pdf" multiple onChange={appendFiles(setMergeFiles)} />
            </label>
            <FileSummary files={mergeFiles} />
            <OrderedFileList
              files={mergeFiles}
              description="The top PDF will be merged first, then the next files below it."
              onReorder={(fromIndex, toIndex) => reorderFiles(setMergeFiles, fromIndex, toIndex)}
              onMoveUp={(index) => moveFile(setMergeFiles, index, -1)}
              onMoveDown={(index) => moveFile(setMergeFiles, index, 1)}
              onRemove={(index) => removeFileAt(setMergeFiles, index)}
              onClear={() => clearFiles(setMergeFiles)}
            />
            <button className="action" disabled={busy || mergeFiles.length < 2} onClick={() => runTask('Merging PDFs...', 'Merged PDF is ready.', async () => { const blob = await mergePdfs(mergeFiles); await downloadResult({ mode: 'single', blob, fileName: 'merged.pdf' }); })}>Merge PDFs</button>
          </article>

          <article className="panel">
            <h2>Split PDF</h2>
            <p>Split each page into its own PDF or enter groups like 1-3,4,5-6 to create custom files.</p>
            <label className="picker">
              <span>Select PDF</span>
              <input type="file" accept="application/pdf" onChange={(event) => setSplitFile(event.target.files?.[0] || null)} />
            </label>
            <FileSummary files={splitFile ? [splitFile] : []} />
            <div className="field-grid single-column">
              <label><span>Split groups</span><input type="text" value={splitRanges} placeholder="Leave empty for one page per file" onChange={(event) => setSplitRanges(event.target.value)} /></label>
            </div>
            <button className="action" disabled={busy || !splitFile} onClick={() => runTask('Splitting PDF...', 'Split files are ready.', async () => { const entries = await splitPdf(splitFile, splitRanges); await downloadEntries(entries, 'split-pdf.zip', 'split.pdf'); })}>Split PDF</button>
          </article>
        </section>
      )}

      {activeTab === 'compress' && (
        <section className="panel-grid two-up">
          <article className="panel">
            <h2>Compress Images</h2>
            <p>Resize and recompress photos to make them smaller before sharing or storing them.</p>
            <label className="picker">
              <span>Add images</span>
              <input type="file" accept="image/*" multiple onChange={appendFiles(setCompressImageFilesState)} />
            </label>
            <FileSummary files={compressImageFilesState} previewImages={compressImagePreviews} />
            <OrderedFileList
              files={compressImageFilesState}
              description="You can add images gradually, keep their order, and still remove or rearrange them at any time."
              onReorder={(fromIndex, toIndex) => reorderFiles(setCompressImageFilesState, fromIndex, toIndex)}
              onMoveUp={(index) => moveFile(setCompressImageFilesState, index, -1)}
              onMoveDown={(index) => moveFile(setCompressImageFilesState, index, 1)}
              onRemove={(index) => removeFileAt(setCompressImageFilesState, index)}
              onClear={() => clearFiles(setCompressImageFilesState)}
            />
            <div className="field-grid">
              <label><span>Format</span><select value={imageCompressOptions.format} onChange={(event) => setImageCompressOptions((current) => ({ ...current, format: event.target.value }))}><option value="jpeg">JPG</option><option value="png">PNG</option><option value="webp">WebP</option><option value="original">Keep original type</option></select></label>
              <label><span>Quality {Math.round(imageCompressOptions.quality * 100)}%</span><input type="range" min="0.35" max="1" step="0.05" value={imageCompressOptions.quality} onChange={(event) => setImageCompressOptions((current) => ({ ...current, quality: Number(event.target.value) }))} /></label>
              <label><span>Max side {imageCompressOptions.maxDimension}px</span><input type="range" min="600" max="2800" step="100" value={imageCompressOptions.maxDimension} onChange={(event) => setImageCompressOptions((current) => ({ ...current, maxDimension: Number(event.target.value) }))} /></label>
            </div>
            <button className="action" disabled={busy || !compressImageFilesState.length} onClick={() => runTask('Compressing images...', 'Compressed images are ready.', async () => { const entries = await compressImages(compressImageFilesState, imageCompressOptions); await downloadEntries(entries, 'compressed-images.zip', 'compressed-image.jpg'); const originalTotal = entries.reduce((sum, entry) => sum + entry.originalSize, 0); const compressedTotal = entries.reduce((sum, entry) => sum + entry.compressedSize, 0); const reduction = originalTotal > 0 ? Math.max(0, Math.round((1 - compressedTotal / originalTotal) * 100)) : 0; return { successText: `Compressed ${entries.length} images from ${formatBytes(originalTotal)} to ${formatBytes(compressedTotal)} (${reduction}% smaller).` }; })}>Compress Images</button>
          </article>

          <article className="panel">
            <h2>Compress PDF</h2>
            <p>Create a smaller PDF copy by re-rendering pages as lower-size images.</p>
            <label className="picker">
              <span>Select PDF</span>
              <input type="file" accept="application/pdf" onChange={(event) => setCompressPdfFile(event.target.files?.[0] || null)} />
            </label>
            <FileSummary files={compressPdfFile ? [compressPdfFile] : []} />
            <div className="field-grid">
              <label><span>Render scale {pdfCompressOptions.scale.toFixed(1)}x</span><input type="range" min="0.8" max="1.8" step="0.1" value={pdfCompressOptions.scale} onChange={(event) => setPdfCompressOptions((current) => ({ ...current, scale: Number(event.target.value) }))} /></label>
              <label><span>Quality {Math.round(pdfCompressOptions.quality * 100)}%</span><input type="range" min="0.35" max="0.9" step="0.05" value={pdfCompressOptions.quality} onChange={(event) => setPdfCompressOptions((current) => ({ ...current, quality: Number(event.target.value) }))} /></label>
            </div>
            <button className="action" disabled={busy || !compressPdfFile} onClick={() => runTask('Compressing PDF...', 'Compressed PDF is ready.', async () => { const blob = await compressPdf(compressPdfFile, pdfCompressOptions); await downloadResult({ mode: 'single', blob, fileName: 'compressed.pdf' }); })}>Compress PDF</button>
          </article>
        </section>
      )}
    </div>
  );
}

export default App;
