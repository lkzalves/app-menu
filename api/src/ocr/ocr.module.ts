import { Module } from '@nestjs/common';
import { OcrProvider } from './ocr.provider.js';
import { TesseractOcrProvider } from './tesseract-ocr.provider.js';

@Module({
  // Quem pedir OcrProvider recebe o Tesseract. Trocar de OCR = mudar só esta linha.
  providers: [{ provide: OcrProvider, useClass: TesseractOcrProvider }],
  exports: [OcrProvider],
})
export class OcrModule {}
