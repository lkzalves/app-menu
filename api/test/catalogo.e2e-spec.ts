import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

// Roda no Postgres de desenvolvimento. O idioma é o marcador: tudo que o teste cria leva um destes
// e é apagado no fim (os nomes saem por cascade). Outros arquivos de e2e usam outros marcadores.
const IT = '__e2e_catalogo_it__';
const PT = '__e2e_catalogo_pt__';

describe('Catálogo de pratos (e2e)', () => {
  let moduleRef: TestingModule;
  let catalogo: import('../src/catalogo/catalogo.service.js').CatalogoService;
  let prisma: import('../src/prisma/prisma.service.js').PrismaService;

  beforeAll(async () => {
    const { CatalogoModule } = await import('../src/catalogo/catalogo.module.js');
    const { CatalogoService } = await import('../src/catalogo/catalogo.service.js');
    const { PrismaService } = await import('../src/prisma/prisma.service.js');
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), CatalogoModule],
    }).compile();
    await moduleRef.init();
    catalogo = moduleRef.get(CatalogoService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.dish.deleteMany({ where: { nomes: { some: { idioma: { in: [IT, PT] } } } } });
    await moduleRef.close();
  });

  it('o mesmo nome (com caixa, acento e artigo diferentes) cai no mesmo prato', async () => {
    const a = await catalogo.obterOuCriar('PATATINE FRITTE', IT);
    expect(await catalogo.obterOuCriar('Patatine Fritte', IT)).toBe(a);
    expect(await catalogo.obterOuCriar('LE PATATINE FRITTE', IT)).toBe(a);
    expect(await prisma.dishName.count({ where: { dishId: a } })).toBe(1); // não duplicou
  });

  it('acento não separa pratos', async () => {
    const a = await catalogo.obterOuCriar('Crème Brûlée', IT);
    expect(await catalogo.obterOuCriar('CREME BRULEE', IT)).toBe(a);
  });

  it('erro de OCR resolve para o mesmo prato', async () => {
    const a = await catalogo.obterOuCriar('I GAMBERI', IT);
    expect(await catalogo.obterOuCriar('IGAMBERI', IT)).toBe(a); // espaço engolido
    expect(await catalogo.obterOuCriar('SUPPLI AL TELEFONO', IT)).not.toBe(a);
    const s = await catalogo.obterOuCriar('SUPPLI AL TELEFONO', IT);
    expect(await catalogo.obterOuCriar('SUPPLI AL TELEFON', IT)).toBe(s); // letra perdida
  });

  it('prato que só começa igual é outro prato', async () => {
    const curto = await catalogo.obterOuCriar('FRITTATINA', IT);
    const longo = await catalogo.obterOuCriar('FRITTATINA BOLOGNESE', IT);
    expect(longo).not.toBe(curto);
    expect(await catalogo.buscar('Frittatina', IT)).toBe(curto);
  });

  it('pratos parecidos mas diferentes não se misturam', async () => {
    const a = await catalogo.obterOuCriar('PIZZA MARGHERITA', IT);
    expect(await catalogo.obterOuCriar('PIZZA MARINARA', IT)).not.toBe(a);
    const b = await catalogo.obterOuCriar('PATATINE TARTUFATE', IT);
    expect(b).not.toBe(await catalogo.buscar('PATATINE FRITTE', IT));
  });

  it('o idioma separa o catálogo', async () => {
    const it = await catalogo.obterOuCriar('TIRAMISU', IT);
    expect(await catalogo.buscar('TIRAMISU', PT)).toBeNull();
    expect(await catalogo.obterOuCriar('TIRAMISU', PT)).not.toBe(it);
  });

  it('buscar devolve null quando nada se parece', async () => {
    expect(await catalogo.buscar('XYZQWK', IT)).toBeNull();
    expect(await catalogo.buscar('|—*', IT)).toBeNull(); // nome sem letras
  });

  it('requisições simultâneas com o mesmo nome criam um prato só', async () => {
    const ids = await Promise.all(Array.from({ length: 6 }, () => catalogo.obterOuCriar('RISOTTO AI FUNGHI', IT)));
    expect(new Set(ids).size).toBe(1);
    expect(await prisma.dishName.count({ where: { idioma: IT, nomeNormalizado: 'risotto ai funghi' } })).toBe(1);
  });

  it('nome sem letras nem números dá erro', async () => {
    await expect(catalogo.obterOuCriar('|—*', IT)).rejects.toThrow();
  });
});
