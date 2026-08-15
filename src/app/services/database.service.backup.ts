import { Injectable } from "@angular/core";
import Database from "@tauri-apps/plugin-sql";

/** id fixo usado enquanto não existe tela de login/autenticação */
export const USUARIO_LOCAL_ID = "usuario-local";

export interface FaturaRef {
  id: string;
  mes_referencia: number;
  ano_referencia: number;
}

@Injectable({
  providedIn: "root",
})
export class DatabaseService {
  private db: any;
  private initPromise: Promise<void> | null = null;

  /**
   * Inicializa a conexão com o banco SQLite e garante que todas as
   * tabelas do sistema financeiro existam. Seguro chamar várias vezes
   * (o trabalho real só roda na primeira chamada).
   */
  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.reallyInit();
    }
    return this.initPromise;
  }

  private async reallyInit(): Promise<void> {
    this.db = await Database.load("sqlite:ggastos.db");

    // Habilita chaves estrangeiras (o SQLite vem com FK desligado por padrão)
    await this.db.execute("PRAGMA foreign_keys = ON;");

    await this.criarTabelas();
    await this.migrarColunas();
    await this.seedUsuarioLocal();

    console.log("Banco SQLite inicializado!");
  }

  private async seedUsuarioLocal(): Promise<void> {
    await this.db.execute(
      `INSERT OR IGNORE INTO usuarios (id, nome, email, senha_hash)
       VALUES (?, 'Usuário Local', 'local@local', 'x')`,
      [USUARIO_LOCAL_ID]
    );
  }

  /** SELECT genérico. Espera a inicialização terminar antes de rodar. */
  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    await this.init();
    return this.db.select(sql, params);
  }

  /** INSERT/UPDATE/DELETE genérico. Espera a inicialização terminar antes de rodar. */
  async run(sql: string, params: any[] = []): Promise<void> {
    await this.init();
    await this.db.execute(sql, params);
  }

  private async criarTabelas(): Promise<void> {
    // ---------- Tabelas sem dependências ----------

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        senha_hash TEXT NOT NULL
      )
    `);

    // ---------- Tabelas com dependências de 1º nível ----------
    // icone/cor ficam direto na tabela: icone = nome do Material Icon
    // (https://fonts.google.com/icons), cor = hex (#rrggbb)

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS contas (
        id TEXT PRIMARY KEY,
        usuario_id TEXT NOT NULL,
        nome TEXT NOT NULL,
        icone TEXT,
        cor TEXT,
        saldo_inicial REAL NOT NULL DEFAULT 0,
        nao_somar_saldo INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
      )
    `);

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS categorias (
        id TEXT PRIMARY KEY,
        usuario_id TEXT NOT NULL,
        categoria_pai_id TEXT,
        tipo TEXT NOT NULL,
        nome TEXT NOT NULL,
        icone TEXT,
        cor TEXT,
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE,
        FOREIGN KEY (categoria_pai_id) REFERENCES categorias (id) ON DELETE SET NULL
      )
    `);

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        usuario_id TEXT NOT NULL,
        nome TEXT NOT NULL,
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
      )
    `);

    // ---------- Cartões de crédito (depende de contas p/ pagamento padrão) ----------

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS cartoes_credito (
        id TEXT PRIMARY KEY,
        usuario_id TEXT NOT NULL,
        nome TEXT NOT NULL,
        icone TEXT,
        cor TEXT,
        limite REAL NOT NULL DEFAULT 0,
        dia_fechamento INTEGER NOT NULL,
        dia_vencimento INTEGER NOT NULL,
        conta_pagamento_id TEXT,
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE,
        FOREIGN KEY (conta_pagamento_id) REFERENCES contas (id) ON DELETE SET NULL
      )
    `);

    // ---------- Limites de gastos (depende de categorias) ----------

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS limites_gastos (
        id TEXT PRIMARY KEY,
        usuario_id TEXT NOT NULL,
        categoria_id TEXT NOT NULL,
        mes INTEGER NOT NULL,
        ano INTEGER NOT NULL,
        valor_limite REAL NOT NULL,
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE,
        FOREIGN KEY (categoria_id) REFERENCES categorias (id) ON DELETE CASCADE
      )
    `);

    // ---------- Faturas (depende de cartões e contas) ----------

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS faturas (
        id TEXT PRIMARY KEY,
        cartao_id TEXT NOT NULL,
        conta_pagamento_id TEXT,
        mes_referencia INTEGER NOT NULL,
        ano_referencia INTEGER NOT NULL,
        data_fechamento TEXT NOT NULL,
        data_vencimento TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'aberta',
        FOREIGN KEY (cartao_id) REFERENCES cartoes_credito (id) ON DELETE CASCADE,
        FOREIGN KEY (conta_pagamento_id) REFERENCES contas (id) ON DELETE SET NULL
      )
    `);

    // ---------- Lançamentos (depende de usuários, categorias, contas, cartões e faturas) ----------

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS lancamentos (
        id TEXT PRIMARY KEY,
        usuario_id TEXT NOT NULL,
        categoria_id TEXT,
        conta_id TEXT,
        cartao_id TEXT,
        fatura_id TEXT,
        tipo TEXT NOT NULL,
        descricao TEXT,
        valor REAL NOT NULL,
        data TEXT NOT NULL,
        confirmado INTEGER NOT NULL DEFAULT 0,
        fixo INTEGER NOT NULL DEFAULT 0,
        frequencia TEXT,
        parcela_atual INTEGER,
        parcela_total INTEGER,
        grupo_parcelamento_id TEXT,
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE,
        FOREIGN KEY (categoria_id) REFERENCES categorias (id) ON DELETE SET NULL,
        FOREIGN KEY (conta_id) REFERENCES contas (id) ON DELETE SET NULL,
        FOREIGN KEY (cartao_id) REFERENCES cartoes_credito (id) ON DELETE SET NULL,
        FOREIGN KEY (fatura_id) REFERENCES faturas (id) ON DELETE SET NULL
      )
    `);

    // ---------- Tabela de junção lançamentos <-> tags ----------

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS lancamentos_tags (
        lancamento_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        PRIMARY KEY (lancamento_id, tag_id),
        FOREIGN KEY (lancamento_id) REFERENCES lancamentos (id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
      )
    `);
  }

  /**
   * Migração leve para bancos já existentes (criados antes das colunas
   * icone/cor existirem). ALTER TABLE ADD COLUMN falha se a coluna já
   * existe, então cada tentativa é isolada e o erro é ignorado.
   */
  private async migrarColunas(): Promise<void> {
    const tentativas: [string, string][] = [
      ["contas", "icone TEXT"],
      ["contas", "cor TEXT"],
      ["categorias", "icone TEXT"],
      ["categorias", "cor TEXT"],
      ["cartoes_credito", "icone TEXT"],
      ["cartoes_credito", "cor TEXT"],
    ];

    for (const [tabela, colunaDef] of tentativas) {
      try {
        await this.db.execute(`ALTER TABLE ${tabela} ADD COLUMN ${colunaDef}`);
      } catch {
        // coluna já existe, ignora
      }
    }
  }

  /** Gera um UUID v4 simples para usar como id das tabelas (crypto nativo do browser/webview). */
  gerarId(): string {
    return crypto.randomUUID();
  }

  private formatarData(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // =====================================================================
  // CARTÃO DE CRÉDITO / FATURAS
  // Núcleo do sistema: toda compra no cartão precisa "cair" na fatura
  // correta, igual ao Organizze.
  //
  // Regra: se o dia da compra é MAIOR que o dia de fechamento do cartão,
  // a compra entra na fatura do mês seguinte (porque a fatura do mês
  // atual já fechou). Caso contrário, entra na fatura do mês corrente.
  //
  // A data de vencimento é calculada a partir do dia de vencimento do
  // cartão: se o dia de vencimento for <= dia de fechamento, o
  // vencimento cai no mês seguinte ao fechamento (caso comum, ex:
  // fecha dia 25, vence dia 5).
  // =====================================================================

  /**
   * Retorna a fatura (existente ou recém-criada) em que uma compra feita
   * em `dataCompraISO` (formato YYYY-MM-DD) deve entrar, para o cartão
   * `cartaoId`.
   */
  async obterOuCriarFatura(cartaoId: string, dataCompraISO: string): Promise<FaturaRef> {
    await this.init();

    const cartoes = await this.db.select(
      "SELECT dia_fechamento, dia_vencimento, conta_pagamento_id FROM cartoes_credito WHERE id = ?",
      [cartaoId]
    );
    if (!cartoes.length) {
      throw new Error("Cartão não encontrado para gerar fatura.");
    }
    const { dia_fechamento, dia_vencimento, conta_pagamento_id } = cartoes[0];

    const dataCompra = new Date(dataCompraISO + "T00:00:00");
    const diaCompra = dataCompra.getDate();

    let mesRef = dataCompra.getMonth() + 1; // 1-12
    let anoRef = dataCompra.getFullYear();
    if (diaCompra > dia_fechamento) {
      mesRef += 1;
      if (mesRef > 12) {
        mesRef = 1;
        anoRef += 1;
      }
    }

    const existentes = await this.db.select(
      "SELECT id FROM faturas WHERE cartao_id = ? AND mes_referencia = ? AND ano_referencia = ?",
      [cartaoId, mesRef, anoRef]
    );
    if (existentes.length) {
      return { id: existentes[0].id, mes_referencia: mesRef, ano_referencia: anoRef };
    }

    const dataFechamento = new Date(anoRef, mesRef - 1, dia_fechamento);

    let mesVenc = mesRef;
    let anoVenc = anoRef;
    if (dia_vencimento <= dia_fechamento) {
      mesVenc += 1;
      if (mesVenc > 12) {
        mesVenc = 1;
        anoVenc += 1;
      }
    }
    const dataVencimento = new Date(anoVenc, mesVenc - 1, dia_vencimento);

    const id = this.gerarId();
    await this.db.execute(
      `INSERT INTO faturas
        (id, cartao_id, conta_pagamento_id, mes_referencia, ano_referencia, data_fechamento, data_vencimento, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'aberta')`,
      [
        id,
        cartaoId,
        conta_pagamento_id ?? null,
        mesRef,
        anoRef,
        this.formatarData(dataFechamento),
        this.formatarData(dataVencimento),
      ]
    );

    return { id, mes_referencia: mesRef, ano_referencia: anoRef };
  }

  /**
   * Marca a fatura como paga e lança uma despesa na conta de pagamento
   * (se houver conta de pagamento padrão configurada) com o valor total
   * dos lançamentos daquela fatura.
   */
  async pagarFatura(faturaId: string): Promise<void> {
    await this.init();

    const faturas = await this.db.select("SELECT * FROM faturas WHERE id = ?", [faturaId]);
    if (!faturas.length) return;
    const fatura = faturas[0];

    const totalRows = await this.db.select(
      "SELECT COALESCE(SUM(valor), 0) as total FROM lancamentos WHERE fatura_id = ?",
      [faturaId]
    );
    const total = totalRows[0]?.total ?? 0;

    if (fatura.conta_pagamento_id && total > 0) {
      await this.db.execute(
        `INSERT INTO lancamentos (id, usuario_id, conta_id, tipo, descricao, valor, data, confirmado)
         VALUES (?, ?, ?, 'despesa', ?, ?, ?, 1)`,
        [
          this.gerarId(),
          USUARIO_LOCAL_ID,
          fatura.conta_pagamento_id,
          `Pagamento fatura ${String(fatura.mes_referencia).padStart(2, "0")}/${fatura.ano_referencia}`,
          total,
          this.formatarData(new Date()),
        ]
      );
    }

    await this.db.execute("UPDATE faturas SET status = 'paga' WHERE id = ?", [faturaId]);
  }
}
