import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { createWriteStream } from 'node:fs';
import { workspaceLayout } from '../workspace/paths.js';
import { marked } from 'marked';

export type PdfInput = {
  title: string;
  markdown: string;
  filename?: string;
};

const COLORS = {
  primary: '#0F172A',   // Slate 900
  secondary: '#334155', // Slate 700
  accent: '#0EA5E9',    // Sky 500
  muted: '#64748B',     // Slate 500
  background: '#FFFFFF',
  divider: '#E2E8F0',   // Slate 200
  codeBg: '#F8FAFC',    // Slate 50
  codeText: '#BE185D',  // Pink 700
};

const FONTS = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  italic: 'Helvetica-Oblique',
  mono: 'Courier',
};

export async function generatePdfDocument(input: PdfInput) {
  const outDir = path.join(workspaceLayout().outputs, 'pdf');
  await mkdir(outDir, { recursive: true });
  const filename = input.filename || `${input.title.replace(/[^\w.-]+/g, '-').slice(0, 60)}.pdf`;
  const filePath = path.join(outDir, filename.endsWith('.pdf') ? filename : `${filename}.pdf`);

  const tokens = marked.lexer(input.markdown);

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 54,
      size: 'A4',
      info: {
        Title: input.title,
        Author: 'ZilMate Assistant',
      }
    });
    const stream = createWriteStream(filePath);
    doc.pipe(stream);

    // Header
    doc.fontSize(24).font(FONTS.bold).fillColor(COLORS.primary).text(input.title, { align: 'left' });
    doc.moveDown(0.5);
    doc.moveTo(54, doc.y).lineTo(541, doc.y).strokeColor(COLORS.accent).lineWidth(2).stroke();
    doc.moveDown(1.5);

    function renderInline(inlineTokens: any[], options: { continued?: boolean } = {}) {
      if (!inlineTokens) return;

      inlineTokens.forEach((token, index) => {
        const isLast = index === inlineTokens.length - 1;
        const continued = options.continued || !isLast;

        if (token.type === 'strong') {
          doc.font(FONTS.bold).text(token.text, { continued });
        } else if (token.type === 'em') {
          doc.font(FONTS.italic).text(token.text, { continued });
        } else if (token.type === 'codespan') {
          doc.font(FONTS.mono).fillColor(COLORS.codeText).text(token.text, { continued });
          doc.font(FONTS.regular).fillColor(COLORS.secondary);
        } else if (token.type === 'link') {
          doc.font(FONTS.regular).fillColor(COLORS.accent).text(token.text, { continued, link: token.href, underline: true });
          doc.fillColor(COLORS.secondary);
        } else if (token.type === 'br') {
          doc.text('\n', { continued });
        } else if (token.tokens) {
          renderInline(token.tokens, { continued });
        } else {
          doc.font(FONTS.regular).text(token.text || token.raw || '', { continued });
        }
      });
    }

    function renderBlocks(tokens: any[]) {
      for (const token of tokens) {
        if (doc.y > 720) doc.addPage();

        switch (token.type) {
          case 'heading': {
            const hSizes = [20, 18, 16, 14, 12, 11];
            const size = hSizes[token.depth - 1] || 11;
            doc.moveDown(0.5)
               .fontSize(size)
               .font(FONTS.bold)
               .fillColor(COLORS.primary)
               .text(token.text);
            doc.moveDown(0.2);
            break;
          }

          case 'paragraph': {
            doc.fontSize(11)
               .font(FONTS.regular)
               .fillColor(COLORS.secondary);
            renderInline(token.tokens || []);
            doc.moveDown(0.8);
            break;
          }

          case 'list': {
            token.items.forEach((item: any, idx: number) => {
              if (doc.y > 720) doc.addPage();
              doc.fontSize(11).font(FONTS.regular).fillColor(COLORS.secondary);
              const prefix = token.ordered ? `${idx + 1}. ` : '• ';
              doc.text(prefix, { continued: true, indent: 12 });

              if (item.tokens) {
                // List items can contain paragraphs or other blocks
                for (const subToken of item.tokens) {
                  if (subToken.type === 'text' || subToken.type === 'paragraph') {
                    renderInline(subToken.tokens || []);
                  } else if (subToken.type === 'list') {
                    doc.moveDown(0.2);
                    renderBlocks([subToken]);
                  }
                }
              }
              doc.moveDown(0.4);
            });
            doc.moveDown(0.4);
            break;
          }

          case 'blockquote': {
            const startY = doc.y;
            doc.fontSize(11).font(FONTS.italic).fillColor(COLORS.muted);
            doc.text(token.text, { indent: 20 });
            const endY = doc.y;
            doc.moveTo(64, startY).lineTo(64, endY).strokeColor(COLORS.divider).lineWidth(2).stroke();
            doc.moveDown(0.8);
            break;
          }

          case 'code': {
            doc.fontSize(10).font(FONTS.mono).fillColor(COLORS.secondary);
            const codeText = token.text;
            const height = doc.heightOfString(codeText) + 10;

            if (doc.y + height > 750) {
              doc.addPage();
            }

            const currentY = doc.y;
            doc.rect(54, currentY, 487, height)
               .fill(COLORS.codeBg);
            doc.fillColor(COLORS.secondary).text(codeText, 59, currentY + 5);
            doc.y = currentY + height;
            doc.moveDown(1);
            break;
          }

          case 'hr': {
            doc.moveDown(0.5);
            doc.moveTo(100, doc.y).lineTo(495, doc.y).strokeColor(COLORS.divider).lineWidth(1).stroke();
            doc.moveDown(1);
            break;
          }

          case 'space':
            break;
        }
      }
    }

    renderBlocks(tokens);

    doc.end();
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });

  return { path: filePath, format: 'pdf' as const, pageEstimate: Math.max(1, Math.ceil(input.markdown.length / 2500)) };
}
