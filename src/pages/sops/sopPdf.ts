/**
 * Capture the rendered SOP read view and save it as an A4 PDF. The caller puts
 * the view into `.ac-sop-printing` first (index hidden, grid flattened, bare
 * URLs shown, copy chips hidden). html2canvas can't read color-mix(), which is
 * why sops.css never uses it.
 */
export async function downloadSopPdf(el: HTMLElement, fileName: string): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const canvas = await html2canvas(el, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#eff6f1',
    windowWidth: el.scrollWidth,
  });

  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const imgW = pageW - margin * 2;
  // Canvas pixels that fit on one page at this width.
  const pxPerPage = Math.floor(((pageH - margin * 2) * canvas.width) / imgW);

  const slice = document.createElement('canvas');
  slice.width = canvas.width;
  const ctx = slice.getContext('2d')!;
  for (let y = 0, page = 0; y < canvas.height; y += pxPerPage, page++) {
    const h = Math.min(pxPerPage, canvas.height - y);
    slice.height = h;
    ctx.fillStyle = '#eff6f1';
    ctx.fillRect(0, 0, slice.width, h);
    ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    if (page > 0) pdf.addPage();
    pdf.setFillColor(239, 246, 241);
    pdf.rect(0, 0, pageW, pageH, 'F');
    pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, imgW, (h * imgW) / canvas.width);
  }
  pdf.save(fileName);
}
