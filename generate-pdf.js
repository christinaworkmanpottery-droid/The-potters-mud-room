const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

function generateMudLogPDF(outputPath) {
  const doc = new PDFDocument({ size: 'letter', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  const brown = '#3E2E24';
  const clay = '#C67B4E';
  const light = '#7A6F66';
  const lineColor = '#D4C8BB';
  const pageW = 512; // usable width

  function drawLine(y, width) {
    doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(50 + (width || pageW), y).stroke();
  }

  function writeLine(y, width) {
    doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(50 + (width || pageW), y).stroke();
    return y;
  }

  function labelAndLine(label, x, y, lineW) {
    doc.fontSize(8).fillColor(light).text(label, x, y - 12, { width: lineW });
    writeLine(y, lineW);
  }

  // ===== COVER PAGE =====
  doc.rect(0, 0, 612, 792).fill('#FAF7F2');
  doc.fontSize(60).font('Helvetica-Bold').fillColor(clay).text('*', 0, 200, { align: 'center' });
  doc.fontSize(36).font('Helvetica-Bold').fillColor(brown).text("The Potter's", 0, 290, { align: 'center' });
  doc.fontSize(36).font('Helvetica-Bold').fillColor(clay).text('Mud Log', 0, 335, { align: 'center' });
  doc.fontSize(14).font('Helvetica').fillColor(light).text('A Printable Pottery Journal', 0, 400, { align: 'center' });
  doc.fontSize(11).fillColor(light).text('Track your pieces, clay bodies, glazes & firings', 0, 425, { align: 'center' });
  doc.fontSize(10).fillColor(light).text('thepottersmudroom.com', 0, 700, { align: 'center' });

  // ===== BELONGS TO PAGE =====
  doc.addPage();
  doc.rect(0, 0, 612, 792).fill('#FAF7F2');
  doc.fontSize(20).font('Helvetica-Bold').fillColor(brown).text('This Mud Log Belongs To:', 50, 200);
  writeLine(260);
  doc.fontSize(9).fillColor(light).text('Name', 50, 265);
  writeLine(310);
  doc.fontSize(9).fillColor(light).text('Studio / Location', 50, 315);
  writeLine(360);
  doc.fontSize(9).fillColor(light).text('Date Started', 50, 365);

  // ===== PIECE LOG PAGES (20 pages) =====
  for (let i = 0; i < 20; i++) {
    doc.addPage();
    doc.rect(0, 0, 612, 792).fill('#FAF7F2');
    
    doc.fontSize(18).font('Helvetica-Bold').fillColor(brown).text('Piece Log', 50, 50);
    doc.fontSize(9).fillColor(light).text('#' + (i + 1), 520, 55);

    let y = 90;

    // Title
    doc.fontSize(9).fillColor(light).text('Piece Title', 50, y);
    y += 14; writeLine(y); y += 20;

    // Row: Clay Body | Technique
    doc.fontSize(9).fillColor(light).text('Clay Body', 50, y);
    doc.text('Technique', 300, y);
    y += 14;
    doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(280, y).stroke();
    doc.moveTo(300, y).lineTo(562, y).stroke();
    y += 20;

    // Row: Form | Status
    doc.fontSize(9).fillColor(light).text('Form (bowl, mug, plate...)', 50, y);
    doc.text('Status', 300, y);
    y += 14;
    doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(280, y).stroke();
    doc.moveTo(300, y).lineTo(562, y).stroke();
    y += 20;

    // Row: Studio | Date Started
    doc.fontSize(9).fillColor(light).text('Studio', 50, y);
    doc.text('Date Started', 300, y);
    y += 14;
    doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(280, y).stroke();
    doc.moveTo(300, y).lineTo(562, y).stroke();
    y += 20;

    // Row: Dimensions | Weight
    doc.fontSize(9).fillColor(light).text('Dimensions', 50, y);
    doc.text('Weight', 300, y);
    y += 14;
    doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(280, y).stroke();
    doc.moveTo(300, y).lineTo(562, y).stroke();
    y += 25;

    // Glazes section
    doc.fontSize(12).font('Helvetica-Bold').fillColor(clay).text('Glazes Used', 50, y);
    y += 20;
    for (let g = 0; g < 3; g++) {
      doc.fontSize(9).font('Helvetica').fillColor(light).text('Glaze ' + (g + 1), 50, y);
      doc.text('Coats', 300, y);
      doc.text('Method (dip/brush/spray)', 380, y);
      y += 14;
      doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(280, y).stroke();
      doc.moveTo(300, y).lineTo(370, y).stroke();
      doc.moveTo(380, y).lineTo(562, y).stroke();
      y += 18;
    }

    y += 10;

    // Firing section
    doc.fontSize(12).font('Helvetica-Bold').fillColor(clay).text('Firing', 50, y);
    y += 20;

    doc.fontSize(9).font('Helvetica').fillColor(light).text('Firing Type (bisque/glaze/raku)', 50, y);
    doc.text('Cone', 300, y);
    doc.text('Atmosphere', 400, y);
    y += 14;
    doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(280, y).stroke();
    doc.moveTo(300, y).lineTo(380, y).stroke();
    doc.moveTo(400, y).lineTo(562, y).stroke();
    y += 18;

    doc.fontSize(9).fillColor(light).text('Kiln', 50, y);
    doc.text('Speed (slow/med/fast)', 200, y);
    doc.text('Hold Used?', 380, y);
    doc.text('Hold Duration', 470, y);
    y += 14;
    doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(180, y).stroke();
    doc.moveTo(200, y).lineTo(360, y).stroke();
    doc.moveTo(380, y).lineTo(455, y).stroke();
    doc.moveTo(470, y).lineTo(562, y).stroke();
    y += 18;

    doc.fontSize(9).fillColor(light).text('Date', 50, y);
    y += 14; 
    doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(200, y).stroke();
    y += 25;

    // Results / Notes
    doc.fontSize(12).font('Helvetica-Bold').fillColor(clay).text('Notes & Results', 50, y);
    y += 18;
    for (let n = 0; n < 6; n++) {
      y += 22;
      writeLine(y);
    }

    // Photo box
    y += 25;
    doc.fontSize(9).fillColor(light).text('📸 Tape or glue a photo here:', 50, y);
    y += 14;
    doc.strokeColor(lineColor).lineWidth(1).rect(50, y, pageW, 100).dash(5, { space: 3 }).stroke();
    doc.undash();

    // Footer
    doc.fontSize(7).fillColor(light).text('thepottersmudroom.com', 50, 760);
  }

  // ===== CLAY BODY LOG (5 pages) =====
  for (let i = 0; i < 5; i++) {
    doc.addPage();
    doc.rect(0, 0, 612, 792).fill('#FAF7F2');
    doc.fontSize(18).font('Helvetica-Bold').fillColor(brown).text('Clay Body Log', 50, 50);
    doc.fontSize(9).fillColor(light).text('#' + (i + 1), 520, 55);

    let y = 90;
    const fields = [
      ['Clay Name', 'Brand / Supplier'],
      ['Type (stoneware/porcelain/earthenware...)', 'Cone Range'],
      ['Color — Wet', 'Color — Fired'],
      ['Shrinkage %', 'Cost per Bag'],
      ['Bag Weight', '']
    ];
    fields.forEach(([l, r]) => {
      doc.fontSize(9).font('Helvetica').fillColor(light).text(l, 50, y);
      if (r) doc.text(r, 300, y);
      y += 14;
      doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(280, y).stroke();
      if (r) doc.moveTo(300, y).lineTo(562, y).stroke();
      y += 20;
    });

    y += 10;
    doc.fontSize(12).font('Helvetica-Bold').fillColor(clay).text('Notes', 50, y);
    y += 18;
    for (let n = 0; n < 10; n++) { y += 22; writeLine(y); }

    doc.fontSize(7).fillColor(light).text('thepottersmudroom.com', 50, 760);
  }

  // ===== GLAZE LOG (10 pages) =====
  for (let i = 0; i < 10; i++) {
    doc.addPage();
    doc.rect(0, 0, 612, 792).fill('#FAF7F2');
    doc.fontSize(18).font('Helvetica-Bold').fillColor(brown).text('Glaze Log', 50, 50);
    doc.fontSize(9).fillColor(light).text('#' + (i + 1), 520, 55);

    let y = 90;
    doc.fontSize(9).font('Helvetica').fillColor(light);
    
    [['Glaze Name', 'Type (commercial/recipe)'],
     ['Brand', 'SKU / Product #'],
     ['Color Description', 'Cone Range'],
     ['Atmosphere (oxidation/reduction/neutral)', 'Surface (gloss/satin/matte)']
    ].forEach(([l, r]) => {
      doc.text(l, 50, y); doc.text(r, 300, y);
      y += 14;
      doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(280, y).stroke();
      doc.moveTo(300, y).lineTo(562, y).stroke();
      y += 20;
    });

    y += 5;
    doc.fontSize(12).font('Helvetica-Bold').fillColor(clay).text('Recipe (if mixing your own)', 50, y);
    y += 18;
    doc.fontSize(9).font('Helvetica').fillColor(light);
    for (let r = 0; r < 6; r++) {
      doc.text('Ingredient', 50, y); doc.text('%', 300, y);
      y += 14;
      doc.strokeColor(lineColor).lineWidth(0.5).moveTo(50, y).lineTo(280, y).stroke();
      doc.moveTo(300, y).lineTo(380, y).stroke();
      y += 16;
    }

    y += 10;
    doc.fontSize(12).font('Helvetica-Bold').fillColor(clay).text('Notes', 50, y);
    y += 18;
    for (let n = 0; n < 4; n++) { y += 22; writeLine(y); }

    // Photo area
    y += 20;
    doc.fontSize(9).font('Helvetica').fillColor(light).text('📸 Glaze result photo:', 50, y);
    y += 14;
    doc.strokeColor(lineColor).lineWidth(1).rect(50, y, 200, 100).dash(5, { space: 3 }).stroke();
    doc.undash();

    doc.fontSize(7).fillColor(light).text('thepottersmudroom.com', 50, 760);
  }

  // ===== BACK COVER =====
  doc.addPage();
  doc.rect(0, 0, 612, 792).fill('#FAF7F2');
  doc.fontSize(24).font('Helvetica-Bold').fillColor(brown).text("Keep Making.", 0, 300, { align: 'center' });
  doc.fontSize(24).fillColor(clay).text("Keep Tracking.", 0, 340, { align: 'center' });
  doc.fontSize(24).fillColor(brown).text("Keep Growing.", 0, 380, { align: 'center' });
  doc.fontSize(12).font('Helvetica').fillColor(light).text('thepottersmudroom.com', 0, 450, { align: 'center' });
  doc.fontSize(10).fillColor(light).text("Built by a potter, for potters.", 0, 475, { align: 'center' });

  doc.end();
  return new Promise((resolve) => stream.on('finish', resolve));
}

if (require.main === module) {
  const out = path.join(__dirname, 'public', 'shop', 'the-potters-mud-log.pdf');
  const dir = path.dirname(out);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  generateMudLogPDF(out).then(() => console.log('PDF generated:', out));
}

module.exports = { generateMudLogPDF };
