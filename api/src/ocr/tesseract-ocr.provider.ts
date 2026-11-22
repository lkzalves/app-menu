import { Injectable } from '@nestjs/common';
import { createWorker } from 'tesseract.js';
import { OcrProvider } from './ocr.provider.js';

// Idiomas dos cardápios-alvo: português, inglês, espanhol e italiano
const IDIOMAS = 'por+eng+spa+ita';

@Injectable()
export class TesseractOcrProvider extends OcrProvider {
  async reconhecer(imagem: Buffer): Promise<string> {
    // Os arquivos de idioma são baixados na 1ª vez e guardados em .tessdata
    const worker = await createWorker(IDIOMAS, undefined, { cachePath: '.tessdata' });
    try {
      const { data } = await worker.recognize(imagem);
      return data.text;
    } finally {
      await worker.terminate(); // libera a memória mesmo se o OCR falhar
    }
  }
}
