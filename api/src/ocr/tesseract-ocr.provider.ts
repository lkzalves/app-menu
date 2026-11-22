import { Injectable } from '@nestjs/common';
import { createWorker, PSM } from 'tesseract.js';
import { OcrProvider } from './ocr.provider.js';
import type { Regiao } from './ocr.provider.js';

// Idiomas dos cardápios-alvo: português, inglês, espanhol e italiano
const IDIOMAS = 'por+eng+spa+ita';

@Injectable()
export class TesseractOcrProvider extends OcrProvider {
  // Os arquivos de idioma são baixados na 1ª vez e guardados em .tessdata
  private criarWorker() {
    return createWorker(IDIOMAS, undefined, { cachePath: '.tessdata' });
  }

  async reconhecer(imagem: Buffer): Promise<string> {
    const worker = await this.criarWorker();
    try {
      const { data } = await worker.recognize(imagem);
      return data.text;
    } finally {
      await worker.terminate(); // libera a memória mesmo se o OCR falhar
    }
  }

  async reconhecerRegioes(imagem: Buffer, regioes: Regiao[]): Promise<string[]> {
    const worker = await this.criarWorker(); // um worker só: o custo de carregar os idiomas é pago 1 vez
    try {
      // SINGLE_BLOCK: o recorte é um bloco de texto, e o nome pode quebrar em 2 linhas
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      const textos: string[] = [];
      for (const r of regioes) {
        // Em sequência: um worker processa um recorte por vez
        const { data } = await worker.recognize(imagem, {
          rectangle: { left: r.x, top: r.y, width: r.largura, height: r.altura },
        });
        textos.push(data.text);
      }
      return textos;
    } finally {
      await worker.terminate();
    }
  }
}
