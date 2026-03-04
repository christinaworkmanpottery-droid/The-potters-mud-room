const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

function generatePreviewPDF(outputPath) {
  const doc = new PDFDocument({ size: 'letter', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  const brown = '#3E2E24';
  const clay = '#C67B4E';
  const light = '#7A6F66';
  const lineColor = '#D4C8BB';
  const pageW = 512;

  function writeLine(y, w) {
    doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(50 + (w || pageW), y).stroke();
  }

  function addWatermark() {
    doc.save();
    doc.rotate(-45, { origin: [306, 396] });
    doc.fontSize(60).fillColor('#C67B4E').opacity(0.15).text('PREVIEW', 80, 350, { align: 'center' });
    doc.opacity(1);
    doc.restore();
  }

  // COVER
  doc.rect(0, 0, 612, 792).fill('#FAF7F2');
  doc.fontSize(60).font('Helvetica-Bold').fillColor(clay).text('*', 0, 200, { align: 'center' });
  doc.fontSize(36).font('Helvetica-Bold').fillColor(brown).text("The Potter's", 0, 290, { align: 'center' });
  doc.fontSize(36).font('Helvetica-Bold').fillColor(clay).text('Mud Log', 0, 335, { align: 'center' });
  doc.fontSize(14).font('Helvetica').fillColor(light).text('A Printable Pottery Journal', 0, 400, { align: 'center' });
  doc.fontSize(11).fillColor(light).text('Track your pieces, clay bodies, glazes & firings', 0, 425, { align: 'center' });
  doc.fontSize(12).fillColor(clay).text('PREVIEW — 3 sample pages', 0, 470, { align: 'center' });
  doc.fontSize(10).fillColor(light).text('Full version: 38 pages — $4.99 at thepottersmudroom.com', 0, 495, { align: 'center' });
  addWatermark();

  // SAMPLE PIECE LOG
  doc.addPage();
  doc.rect(0, 0, 612, 792).fill('#FAF7F2');
  doc.fontSize(18).font('Helvetica-Bold').fillColor(brown).text('Piece Log', 50, 50);
  doc.fontSize(9).fillColor(light).text('#1', 520, 55);
  let y = 90;
  doc.fontSize(9).font('Helvetica').fillColor(light).text('Piece Title', 50, y); y += 14; writeLine(y); y += 20;
  doc.text('Clay Body', 50, y); doc.text('Technique', 300, y); y += 14;
  doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(280, y).stroke(); doc.moveTo(300, y).lineTo(562, y).stroke(); y += 20;
  doc.text('Form (bowl, mug, plate...)', 50, y); doc.text('Status', 300, y); y += 14;
  doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(280, y).stroke(); doc.moveTo(300, y).lineTo(562, y).stroke(); y += 20;
  doc.text('Studio', 50, y); doc.text('Date Started', 300, y); y += 14;
  doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(280, y).stroke(); doc.moveTo(300, y).lineTo(562, y).stroke(); y += 25;
  doc.fontSize(12).font('Helvetica-Bold').fillColor(clay).text('Glazes Used', 50, y); y += 20;
  for (let g = 0; g < 3; g++) {
    doc.fontSize(9).font('Helvetica').fillColor(light).text('Glaze ' + (g+1), 50, y); doc.text('Coats', 300, y); doc.text('Method', 380, y); y += 14;
    doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(280, y).stroke(); doc.moveTo(300, y).lineTo(370, y).stroke(); doc.moveTo(380, y).lineTo(562, y).stroke(); y += 18;
  }
  y += 10;
  doc.fontSize(12).font('Helvetica-Bold').fillColor(clay).text('Firing', 50, y); y += 20;
  doc.fontSize(9).font('Helvetica').fillColor(light).text('Firing Type', 50, y); doc.text('Cone', 300, y); doc.text('Atmosphere', 400, y); y += 14;
  doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(280, y).stroke(); doc.moveTo(300, y).lineTo(380, y).stroke(); doc.moveTo(400, y).lineTo(562, y).stroke(); y += 18;
  doc.text('Kiln', 50, y); doc.text('Speed', 200, y); doc.text('Hold?', 380, y); doc.text('Hold Duration', 470, y); y += 14;
  doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(180, y).stroke(); doc.moveTo(200, y).lineTo(360, y).stroke(); doc.moveTo(380, y).lineTo(455, y).stroke(); doc.moveTo(470, y).lineTo(562, y).stroke(); y += 25;
  doc.fontSize(12).font('Helvetica-Bold').fillColor(clay).text('Notes & Results', 50, y); y += 18;
  for (let n = 0; n < 5; n++) { y += 22; writeLine(y); }
  addWatermark();

  // SAMPLE GLAZE LOG
  doc.addPage();
  doc.rect(0, 0, 612, 792).fill('#FAF7F2');
  doc.fontSize(18).font('Helvetica-Bold').fillColor(brown).text('Glaze Log', 50, 50);
  doc.fontSize(9).fillColor(light).text('#1', 520, 55);
  y = 90;
  doc.fontSize(9).font('Helvetica').fillColor(light);
  [['Glaze Name','Type (commercial/recipe)'],['Brand','SKU / Product #'],['Color Description','Cone Range'],['Atmosphere','Surface']].forEach(function(pair) {
    doc.text(pair[0], 50, y); doc.text(pair[1], 300, y); y += 14;
    doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(280, y).stroke(); doc.moveTo(300, y).lineTo(562, y).stroke(); y += 20;
  });
  y += 5;
  doc.fontSize(12).font('Helvetica-Bold').fillColor(clay).text('Recipe (if mixing your own)', 50, y); y += 18;
  doc.fontSize(9).font('Helvetica').fillColor(light);
  for (let r = 0; r < 6; r++) { doc.text('Ingredient', 50, y); doc.text('%', 300, y); y += 14; doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(280, y).stroke(); doc.moveTo(300, y).lineTo(380, y).stroke(); y += 16; }
  y += 10;
  doc.fontSize(12).font('Helvetica-Bold').fillColor(clay).text('Notes', 50, y); y += 18;
  for (let n = 0; n < 4; n++) { y += 22; writeLine(y); }
  addWatermark();

  // BUY PAGE
  doc.addPage();
  doc.rect(0, 0, 612, 792).fill('#FAF7F2');
  doc.fontSize(28).font('Helvetica-Bold').fillColor(brown).text('Want the full Mud Log?', 0, 250, { align: 'center' });
  doc.fontSize(16).font('Helvetica').fillColor(light).text('38 pages · 20 Piece Logs · 5 Clay Body Logs · 10 Glaze Logs', 0, 300, { align: 'center' });
  doc.fontSize(20).font('Helvetica-Bold').fillColor(clay).text('$4.99 at thepottersmudroom.com/shop', 0, 350, { align: 'center' });
  doc.fontSize(12).font('Helvetica').fillColor(light).text('Print it. Bind it. Take it to the studio.', 0, 400, { align: 'center' });

  doc.end();
  return new Promise(function(resolve) { stream.on('finish', resolve); });
}

if (require.main === module) {
  const out = path.join(__dirname, 'public', 'shop', 'mud-log-preview.pdf');
  const dir = path.dirname(out);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  generatePreviewPDF(out).then(function() { console.log('Preview PDF generated:', out); });
}

module.exports = { generatePreviewPDF };
