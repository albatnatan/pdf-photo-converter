# PDF & Photo Converter

A browser-based React app for:

- converting images to PDF
- converting PDF pages to images
- merging PDFs
- splitting PDFs
- reducing image sizes
- creating smaller PDF copies

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Features

- **Images to PDF**
  - combine many images into one PDF
  - create one PDF per image
  - choose A4 or fit-to-image pages
  - reduce output size with image quality and width controls

- **PDF to Images**
  - export all pages or selected pages
  - PNG, JPG, or WebP output
  - adjustable quality and render scale

- **PDF Tools**
  - merge multiple PDFs into one
  - split a PDF into separate files by page or by custom groups
  - create a compressed PDF copy by rasterizing pages at a lower quality

- **Image Compression**
  - resize and compress images before downloading
  - export as JPG, PNG, WebP, or keep the original format

## Notes

- PDF compression in the app is lossy and works best for scanned or image-heavy PDFs.
- Text PDFs can become less sharp after compression because pages are rebuilt as images.
- All processing happens in the browser.
