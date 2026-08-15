import { Injectable } from "@angular/core";
import Database from "@tauri-apps/plugin-sql";

/** id fixo usado enquanto não existe tela de login/autenticação */
export const USUARIO_LOCAL_ID = "usuario-local";

export type TipoLancamento = "receita" | "despesa";

export type FrequenciaLancamento =
  | "diario"
  | "semanal"
  | "quinzenal"
  | "mensal"
  | "bimestral"
  | "trimestral"
  | "semestral"
  | "anual";

export interface FaturaRef {
  id: string;
  mes_referencia: number;
  ano_referencia: number;
}

export interface PagamentoFatura {
  id: string;
  valor: number;
  data: string;
  conta_id: string | null;
  conta_nome: string | null;
}

export interface FaturaResumoPeriodo {
  id: string;
  cartao_id: string;
  cartao_nome: string;
  cartao_icone: string | null;
  cartao_cor: string | null;
  mes_referencia: number;
  ano_referencia: number;
  data_vencimento: string;
  valorTotal: number;
}

export interface FaturaDetalhada {
  id: string;
  cartao_id: string;
  cartao_nome: string;
  cartao_icone: string | null;
  cartao_cor: string | null;
  conta_pagamento_id: string | null;
  mes_referencia: number;
  ano_referencia: number;
  data_fechamento: string;
  data_vencimento: string;
  status: string;
  faturaAtual: number;
  saldoAnterior: number;
  valorTotal: number;
  valorPago: number;
  valorRestante: number;
  ehAtual: boolean;
  ehPaga: boolean;
  pagamentos: PagamentoFatura[];
}

interface SaldoFatura {
  faturaAtual: number;
  saldoAnterior: number;
  valorTotal: number;
  valorPago: number;
  valorRestante: number;
}

export interface LancamentoBase {
  id?: string;
  usuario_id?: string;

  categoria_id?: string | null;
  conta_id?: string | null;
  cartao_id?: string | null;
  fatura_id?: string | null;

  tipo: TipoLancamento;
  descricao?: string | null;
  valor: number;
  data: string;

  confirmado?: boolean;
  fixo?: boolean;

  frequencia?: FrequenciaLancamento | null;

  parcela_atual?: number | null;
  parcela_total?: number | null;

  grupo_parcelamento_id?: string | null;
}

export interface CriarLancamentoOpcoes {
  categoria_id?: string | null;
  conta_id?: string | null;
  cartao_id?: string | null;

  tipo: TipoLancamento;
  descricao?: string | null;
  valor: number;
  data: string;

  confirmado?: boolean;

  /**
   * Quando true, gera lançamentos individuais até o fim do ano.
   */
  fixo?: boolean;

  /**
   * Frequência usada pelo lançamento fixo.
   * Ex.: mensal, semanal, anual...
   */
  frequencia?: FrequenciaLancamento | null;

  /**
   * Quantidade de parcelas.
   *
   * Se informado e > 1, serão criados vários lançamentos,
   * um para cada parcela.
   */
  parcela_total?: number | null;

  /**
   * Quantidade máxima de ocorrências para um lançamento fixo.
   *
   * Normalmente não precisa ser informado, pois o padrão é
   * gerar até 31/12 do ano da data inicial.
   */
  data_fim?: string | null;
}

export type EscopoEdicao = "atual" | "atual_e_proximos" | "todos";

export interface AlteracoesLancamento {
  descricao?: string | null;
  valor?: number;
  data?: string;
  conta_id?: string | null;
  cartao_id?: string | null;
  categoria_id?: string | null;
  confirmado?: boolean;
  /** Só faz sentido quando o lançamento é fixo. */
  frequencia?: FrequenciaLancamento;
  /** Só faz sentido quando o lançamento é parcelado (nova quantidade de parcelas a partir do escopo escolhido). */
  parcela_total?: number;
}

export interface LancamentoGerado {
  id: string;
  data: string;
  parcela_atual: number | null;
  parcela_total: number | null;
  fatura_id: string | null;
}

@Injectable({
  providedIn: "root",
})
export class DatabaseService {
  private db: any;
  private initPromise: Promise<void> | null = null;

  /** Fila usada por serializarConexao() para garantir 1 operação por vez. */
  private filaOperacoes: Promise<any> = Promise.resolve();

  // =====================================================================
  // INICIALIZAÇÃO
  // =====================================================================

  /**
   * Inicializa a conexão com o banco SQLite e garante que todas as
   * tabelas do sistema financeiro existam.
   *
   * Seguro chamar várias vezes.
   */
  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.reallyInit();
    }

    return this.initPromise;
  }

  private async reallyInit(): Promise<void> {
    const conexao = await Database.load("sqlite:ggastos.db");

    this.db = this.serializarConexao(conexao);

    // SQLite vem com foreign_keys desabilitado por padrão.
    await this.db.execute("PRAGMA foreign_keys = ON;");

    await this.criarTabelas();
    await this.migrarColunas();
    await this.criarIndices();
    await this.seedUsuarioLocal();

    console.log("Banco SQLite inicializado!");
  }

  /**
   * Serializa todas as chamadas execute/select numa fila única.
   *
   * Necessário porque as transações do app são mandadas como statements
   * SQL soltos (BEGIN/COMMIT/ROLLBACK via este mesmo execute, não existe
   * uma API de transação no plugin). Se duas operações do banco rodarem
   * concorrentemente — por ex. o app-lancamento-modal carregando contas/
   * cartões/categorias enquanto uma fatura está registrando um pagamento
   * em transação — uma delas pode tentar abrir uma transação por cima da
   * outra que ainda está aberta ("cannot start a transaction within a
   * transaction"). Enfileirando tudo aqui garantimos só 1 operação em
   * voo por vez na conexão.
   */
  private serializarConexao(conexao: any): any {
    const enfileirar = <T>(operacao: () => Promise<T>): Promise<T> => {
      const resultado = this.filaOperacoes.then(operacao, operacao);

      // A fila continua mesmo se essa operação falhar — senão uma
      // rejeição travaria todas as chamadas seguintes pra sempre.
      this.filaOperacoes = resultado.then(
        () => undefined,
        () => undefined,
      );

      return resultado;
    };

    return {
      execute: (sql: string, params?: any[]) =>
        enfileirar(() => conexao.execute(sql, params)),
      select: (sql: string, params?: any[]) =>
        enfileirar(() => conexao.select(sql, params)),
    };
  }

  // =====================================================================
  // USUÁRIO LOCAL
  // =====================================================================

  private async seedUsuarioLocal(): Promise<void> {
    await this.db.execute(
      `
      INSERT OR IGNORE INTO usuarios
        (id, nome, email, senha_hash)
      VALUES
        (?, 'Usuário Local', 'local@local', 'x')
      `,
      [USUARIO_LOCAL_ID]
    );
  }

  // =====================================================================
  // QUERY / RUN
  // =====================================================================

  /**
   * SELECT genérico.
   */
  async query<T = any>(
    sql: string,
    params: any[] = []
  ): Promise<T[]> {
    await this.init();

    return this.db.select(sql, params);
  }

  /**
   * INSERT / UPDATE / DELETE genérico.
   */
  async run(
    sql: string,
    params: any[] = []
  ): Promise<void> {
    await this.init();

    await this.db.execute(sql, params);
  }

  // =====================================================================
  // TABELAS
  // =====================================================================

  private async criarTabelas(): Promise<void> {
    // -------------------------------------------------------------------
    // USUÁRIOS
    // -------------------------------------------------------------------

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        senha_hash TEXT NOT NULL
      )
    `);

    // -------------------------------------------------------------------
    // CONTAS
    // -------------------------------------------------------------------

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS contas (
        id TEXT PRIMARY KEY,
        usuario_id TEXT NOT NULL,
        nome TEXT NOT NULL,
        icone TEXT,
        cor TEXT,
        saldo_inicial REAL NOT NULL DEFAULT 0,
        nao_somar_saldo INTEGER NOT NULL DEFAULT 0,

        FOREIGN KEY (usuario_id)
          REFERENCES usuarios (id)
          ON DELETE CASCADE
      )
    `);

    // -------------------------------------------------------------------
    // CATEGORIAS
    // -------------------------------------------------------------------

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS categorias (
        id TEXT PRIMARY KEY,
        usuario_id TEXT NOT NULL,
        categoria_pai_id TEXT,
        tipo TEXT NOT NULL,
        nome TEXT NOT NULL,
        icone TEXT,
        cor TEXT,

        FOREIGN KEY (usuario_id)
          REFERENCES usuarios (id)
          ON DELETE CASCADE,

        FOREIGN KEY (categoria_pai_id)
          REFERENCES categorias (id)
          ON DELETE SET NULL
      )
    `);

    // -------------------------------------------------------------------
    // TAGS
    // -------------------------------------------------------------------

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        usuario_id TEXT NOT NULL,
        nome TEXT NOT NULL,

        FOREIGN KEY (usuario_id)
          REFERENCES usuarios (id)
          ON DELETE CASCADE
      )
    `);

    // -------------------------------------------------------------------
    // CARTÕES
    // -------------------------------------------------------------------

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

        FOREIGN KEY (usuario_id)
          REFERENCES usuarios (id)
          ON DELETE CASCADE,

        FOREIGN KEY (conta_pagamento_id)
          REFERENCES contas (id)
          ON DELETE SET NULL
      )
    `);

    // -------------------------------------------------------------------
    // LIMITES DE GASTOS
    // -------------------------------------------------------------------

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS limites_gastos (
        id TEXT PRIMARY KEY,
        usuario_id TEXT NOT NULL,
        categoria_id TEXT NOT NULL,
        mes INTEGER NOT NULL,
        ano INTEGER NOT NULL,
        valor_limite REAL NOT NULL,

        FOREIGN KEY (usuario_id)
          REFERENCES usuarios (id)
          ON DELETE CASCADE,

        FOREIGN KEY (categoria_id)
          REFERENCES categorias (id)
          ON DELETE CASCADE
      )
    `);

    // -------------------------------------------------------------------
    // FATURAS
    // -------------------------------------------------------------------

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

        FOREIGN KEY (cartao_id)
          REFERENCES cartoes_credito (id)
          ON DELETE CASCADE,

        FOREIGN KEY (conta_pagamento_id)
          REFERENCES contas (id)
          ON DELETE SET NULL
      )
    `);

    // -------------------------------------------------------------------
    // FATURAS <-> PAGAMENTOS
    // -------------------------------------------------------------------
    // Cada pagamento (podendo ser parcial) gera 1 lançamento de despesa na
    // conta escolhida (lancamento_id), pra manter saldo de conta e
    // relatórios corretos sem precisar de nenhuma lógica extra lá.

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS faturas_pagamentos (
        id TEXT PRIMARY KEY,
        fatura_id TEXT NOT NULL,
        lancamento_id TEXT NOT NULL,
        conta_id TEXT,
        valor REAL NOT NULL,
        data TEXT NOT NULL,

        FOREIGN KEY (fatura_id)
          REFERENCES faturas (id)
          ON DELETE CASCADE,

        FOREIGN KEY (lancamento_id)
          REFERENCES lancamentos (id)
          ON DELETE CASCADE,

        FOREIGN KEY (conta_id)
          REFERENCES contas (id)
          ON DELETE SET NULL
      )
    `);

    // -------------------------------------------------------------------
    // LANÇAMENTOS
    // -------------------------------------------------------------------

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

        observacao TEXT,

        FOREIGN KEY (usuario_id)
          REFERENCES usuarios (id)
          ON DELETE CASCADE,

        FOREIGN KEY (categoria_id)
          REFERENCES categorias (id)
          ON DELETE SET NULL,

        FOREIGN KEY (conta_id)
          REFERENCES contas (id)
          ON DELETE SET NULL,

        FOREIGN KEY (cartao_id)
          REFERENCES cartoes_credito (id)
          ON DELETE SET NULL,

        FOREIGN KEY (fatura_id)
          REFERENCES faturas (id)
          ON DELETE SET NULL
      )
    `);

    // -------------------------------------------------------------------
    // LANÇAMENTOS <-> TAGS
    // -------------------------------------------------------------------

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS lancamentos_tags (
        lancamento_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,

        PRIMARY KEY (lancamento_id, tag_id),

        FOREIGN KEY (lancamento_id)
          REFERENCES lancamentos (id)
          ON DELETE CASCADE,

        FOREIGN KEY (tag_id)
          REFERENCES tags (id)
          ON DELETE CASCADE
      )
    `);

    // -------------------------------------------------------------------
    // LANÇAMENTOS <-> ANEXOS
    // -------------------------------------------------------------------
    // Guardamos o arquivo como base64 direto no SQLite (conteudo TEXT).
    // Simples e funciona offline, sem precisar mexer em permissões de
    // sistema de arquivos do Tauri.

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS lancamentos_anexos (
        id TEXT PRIMARY KEY,
        lancamento_id TEXT NOT NULL,
        nome TEXT NOT NULL,
        tipo TEXT,
        tamanho INTEGER NOT NULL DEFAULT 0,
        conteudo TEXT NOT NULL,

        FOREIGN KEY (lancamento_id)
          REFERENCES lancamentos (id)
          ON DELETE CASCADE
      )
    `);
  }

  // =====================================================================
  // MIGRAÇÕES
  // =====================================================================

  private async migrarColunas(): Promise<void> {
    const tentativas: [string, string][] = [
      ["contas", "icone TEXT"],
      ["contas", "cor TEXT"],

      ["categorias", "icone TEXT"],
      ["categorias", "cor TEXT"],

      ["cartoes_credito", "icone TEXT"],
      ["cartoes_credito", "cor TEXT"],

      ["lancamentos", "confirmado INTEGER NOT NULL DEFAULT 0"],
      ["lancamentos", "fixo INTEGER NOT NULL DEFAULT 0"],
      ["lancamentos", "frequencia TEXT"],
      ["lancamentos", "parcela_atual INTEGER"],
      ["lancamentos", "parcela_total INTEGER"],
      ["lancamentos", "grupo_parcelamento_id TEXT"],
      ["lancamentos", "observacao TEXT"],
    ];

    for (const [tabela, colunaDef] of tentativas) {
      try {
        await this.db.execute(
          `ALTER TABLE ${tabela} ADD COLUMN ${colunaDef}`
        );
      } catch {
        // A coluna provavelmente já existe.
      }
    }
  }

  // =====================================================================
  // ÍNDICES
  // =====================================================================

  private async criarIndices(): Promise<void> {
    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_contas_usuario
      ON contas(usuario_id)
    `);

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_categorias_usuario
      ON categorias(usuario_id)
    `);

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_tags_usuario
      ON tags(usuario_id)
    `);

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_cartoes_usuario
      ON cartoes_credito(usuario_id)
    `);

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_lancamentos_usuario
      ON lancamentos(usuario_id)
    `);

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_lancamentos_data
      ON lancamentos(data)
    `);

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_lancamentos_tipo
      ON lancamentos(tipo)
    `);

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_lancamentos_fatura
      ON lancamentos(fatura_id)
    `);

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_lancamentos_grupo
      ON lancamentos(grupo_parcelamento_id)
    `);

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_faturas_cartao_periodo
      ON faturas(cartao_id, ano_referencia, mes_referencia)
    `);

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_faturas_pagamentos_fatura
      ON faturas_pagamentos(fatura_id)
    `);

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_limites_categoria_periodo
      ON limites_gastos(categoria_id, ano, mes)
    `);

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_anexos_lancamento
      ON lancamentos_anexos(lancamento_id)
    `);

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_lancamentos_tags_lancamento
      ON lancamentos_tags(lancamento_id)
    `);
  }

  // =====================================================================
  // UTILITÁRIOS
  // =====================================================================

  /**
   * Gera UUID v4.
   */
  gerarId(): string {
    return crypto.randomUUID();
  }

  /**
   * Formata Date para YYYY-MM-DD.
   */
  private formatarData(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");

    return `${y}-${m}-${day}`;
  }

  /**
   * Converte YYYY-MM-DD para Date local.
   */
  private parseData(dataISO: string): Date {
    const partes = dataISO.split("-").map(Number);

    if (partes.length !== 3) {
      throw new Error(
        `Data inválida: ${dataISO}. Use o formato YYYY-MM-DD.`
      );
    }

    const [ano, mes, dia] = partes;

    const data = new Date(ano, mes - 1, dia);

    if (
      data.getFullYear() !== ano ||
      data.getMonth() !== mes - 1 ||
      data.getDate() !== dia
    ) {
      throw new Error(`Data inválida: ${dataISO}.`);
    }

    return data;
  }

  /**
   * Adiciona meses preservando o dia sempre que possível.
   *
   * Exemplo:
   * 31/01 + 1 mês => 28/02
   */
  private adicionarMeses(data: Date, quantidade: number): Date {
    const originalDia = data.getDate();

    const resultado = new Date(
      data.getFullYear(),
      data.getMonth() + quantidade,
      1
    );

    const ultimoDia = new Date(
      resultado.getFullYear(),
      resultado.getMonth() + 1,
      0
    ).getDate();

    resultado.setDate(
      Math.min(originalDia, ultimoDia)
    );

    return resultado;
  }

  /**
   * Adiciona uma frequência.
   */
  private adicionarFrequencia(
    data: Date,
    frequencia: FrequenciaLancamento
  ): Date {
    switch (frequencia) {
      case "diario":
        return new Date(
          data.getFullYear(),
          data.getMonth(),
          data.getDate() + 1
        );

      case "semanal":
        return new Date(
          data.getFullYear(),
          data.getMonth(),
          data.getDate() + 7
        );

      case "quinzenal":
        return new Date(
          data.getFullYear(),
          data.getMonth(),
          data.getDate() + 15
        );

      case "mensal":
        return this.adicionarMeses(data, 1);

      case "bimestral":
        return this.adicionarMeses(data, 2);

      case "trimestral":
        return this.adicionarMeses(data, 3);

      case "semestral":
        return this.adicionarMeses(data, 6);

      case "anual":
        return this.adicionarMeses(data, 12);

      default:
        throw new Error(
          `Frequência inválida: ${frequencia}`
        );
    }
  }

  /**
   * Retorna 31/12 do ano informado.
   */
  private fimDoAno(ano: number): Date {
    return new Date(ano, 11, 31);
  }

  // =====================================================================
  // CARTÃO / FATURA
  // =====================================================================

  /**
   * Obtém ou cria a fatura correspondente a uma compra.
   *
   * Regra:
   * - compra no dia <= fechamento => fatura do mês atual;
   * - compra depois do fechamento => fatura do mês seguinte.
   */
  async obterOuCriarFatura(
    cartaoId: string,
    dataCompraISO: string
  ): Promise<FaturaRef> {
    await this.init();

    const cartoes = await this.db.select(
      `
      SELECT
        dia_fechamento,
        dia_vencimento,
        conta_pagamento_id
      FROM cartoes_credito
      WHERE id = ?
      `,
      [cartaoId]
    );

    if (!cartoes.length) {
      throw new Error(
        "Cartão não encontrado para gerar fatura."
      );
    }

    const {
      dia_fechamento,
      dia_vencimento,
      conta_pagamento_id,
    } = cartoes[0];

    const dataCompra = this.parseData(dataCompraISO);

    const diaCompra = dataCompra.getDate();

    let mesRef = dataCompra.getMonth() + 1;
    let anoRef = dataCompra.getFullYear();

    if (diaCompra > dia_fechamento) {
      mesRef++;

      if (mesRef > 12) {
        mesRef = 1;
        anoRef++;
      }
    }

    const existentes = await this.db.select(
      `
      SELECT id
      FROM faturas
      WHERE cartao_id = ?
        AND mes_referencia = ?
        AND ano_referencia = ?
      LIMIT 1
      `,
      [cartaoId, mesRef, anoRef]
    );

    if (existentes.length) {
      return {
        id: existentes[0].id,
        mes_referencia: mesRef,
        ano_referencia: anoRef,
      };
    }

    const dataFechamento = this.criarDataSegura(
      anoRef,
      mesRef,
      dia_fechamento
    );

    let mesVenc = mesRef;
    let anoVenc = anoRef;

    if (dia_vencimento <= dia_fechamento) {
      mesVenc++;

      if (mesVenc > 12) {
        mesVenc = 1;
        anoVenc++;
      }
    }

    const dataVencimento = this.criarDataSegura(
      anoVenc,
      mesVenc,
      dia_vencimento
    );

    const id = this.gerarId();

    await this.db.execute(
      `
      INSERT INTO faturas (
        id,
        cartao_id,
        conta_pagamento_id,
        mes_referencia,
        ano_referencia,
        data_fechamento,
        data_vencimento,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'aberta')
      `,
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

    return {
      id,
      mes_referencia: mesRef,
      ano_referencia: anoRef,
    };
  }

  /**
   * Cria uma data respeitando o último dia do mês.
   *
   * Exemplo:
   * dia 31 em fevereiro => último dia de fevereiro.
   */
  private criarDataSegura(
    ano: number,
    mes: number,
    dia: number
  ): Date {
    const primeiroDia = new Date(
      ano,
      mes - 1,
      1
    );

    const ultimoDia = new Date(
      ano,
      mes,
      0
    ).getDate();

    return new Date(
      primeiroDia.getFullYear(),
      primeiroDia.getMonth(),
      Math.min(dia, ultimoDia)
    );
  }

  // =====================================================================
  // LANÇAMENTOS
  // =====================================================================

  /**
   * Cria um lançamento simples.
   *
   * Se:
   * - parcela_total > 1 => cria todas as parcelas;
   * - fixo = true => replica até o fim do ano.
   */
  async criarLancamento(
    opcoes: CriarLancamentoOpcoes
  ): Promise<LancamentoGerado[]> {
    await this.init();

    this.validarLancamento(opcoes);

    const parcelaTotal =
      opcoes.parcela_total && opcoes.parcela_total > 1
        ? Math.floor(opcoes.parcela_total)
        : null;

    // ---------------------------------------------------------------
    // PARCELADO
    // ---------------------------------------------------------------

    if (parcelaTotal) {
      return this.criarLancamentoParcelado(
        opcoes,
        parcelaTotal
      );
    }

    // ---------------------------------------------------------------
    // FIXO
    // ---------------------------------------------------------------

    if (opcoes.fixo) {
      return this.criarLancamentoFixo(opcoes);
    }

    // ---------------------------------------------------------------
    // NORMAL
    // ---------------------------------------------------------------

    const lancamento = await this.inserirLancamento({
      usuario_id: USUARIO_LOCAL_ID,

      categoria_id: opcoes.categoria_id ?? null,
      conta_id: opcoes.conta_id ?? null,
      cartao_id: opcoes.cartao_id ?? null,

      tipo: opcoes.tipo,

      descricao: opcoes.descricao ?? null,
      valor: opcoes.valor,
      data: opcoes.data,

      confirmado: opcoes.confirmado ?? false,

      fixo: false,
      frequencia: null,

      parcela_atual: null,
      parcela_total: null,

      grupo_parcelamento_id: null,
    });

    return [lancamento];
  }

  // =====================================================================
  // LANÇAMENTO PARCELADO
  // =====================================================================

  /**
   * Cria todas as parcelas de uma vez.
   *
   * Exemplo:
   *
   * R$ 300 em 3x
   *
   * 01/08 - parcela 1/3 - R$ 100
   * 01/09 - parcela 2/3 - R$ 100
   * 01/10 - parcela 3/3 - R$ 100
   *
   * Todas recebem o mesmo grupo_parcelamento_id.
   */
  private async criarLancamentoParcelado(
    opcoes: CriarLancamentoOpcoes,
    parcelaTotal: number
  ): Promise<LancamentoGerado[]> {
    const grupoId = this.gerarId();

    const resultados: LancamentoGerado[] = [];

    await this.db.execute("BEGIN TRANSACTION");

    try {
      const dataInicial = this.parseData(opcoes.data);

      for (let i = 0; i < parcelaTotal; i++) {
        const dataParcela = this.adicionarMeses(
          dataInicial,
          i
        );

        const resultado = await this.inserirLancamento({
          usuario_id: USUARIO_LOCAL_ID,

          categoria_id: opcoes.categoria_id ?? null,
          conta_id: opcoes.conta_id ?? null,
          cartao_id: opcoes.cartao_id ?? null,

          tipo: opcoes.tipo,

          descricao: opcoes.descricao ?? null,
          valor: opcoes.valor,
          data: this.formatarData(dataParcela),

          confirmado: opcoes.confirmado ?? false,

          fixo: false,
          frequencia: null,

          parcela_atual: i + 1,
          parcela_total: parcelaTotal,

          grupo_parcelamento_id: grupoId,
        });

        resultados.push(resultado);
      }

      await this.db.execute("COMMIT");

      return resultados;
    } catch (erro) {
      await this.db.execute("ROLLBACK");
      throw erro;
    }
  }

  // =====================================================================
  // LANÇAMENTO FIXO
  // =====================================================================

  /**
   * Cria todas as ocorrências de um lançamento fixo até 31/12
   * do ano da data inicial.
   *
   * Exemplo:
   *
   * Netflix
   * R$ 50
   * 10/08/2026
   * mensal
   *
   * Gera:
   *
   * 10/08
   * 10/09
   * 10/10
   * 10/11
   * 10/12
   *
   * Cada uma é uma linha independente no banco.
   */
  private async criarLancamentoFixo(
    opcoes: CriarLancamentoOpcoes
  ): Promise<LancamentoGerado[]> {
    if (!opcoes.frequencia) {
      throw new Error(
        "Um lançamento fixo precisa informar a frequência."
      );
    }

    const dataInicial = this.parseData(opcoes.data);

    const dataFim = opcoes.data_fim
      ? this.parseData(opcoes.data_fim)
      : this.fimDoAno(dataInicial.getFullYear());

    if (dataFim < dataInicial) {
      throw new Error(
        "A data final do lançamento fixo não pode ser anterior à data inicial."
      );
    }

    const resultados: LancamentoGerado[] = [];

    await this.db.execute("BEGIN TRANSACTION");

    try {
      let dataAtual = new Date(dataInicial);

      while (dataAtual <= dataFim) {
        const resultado = await this.inserirLancamento({
          usuario_id: USUARIO_LOCAL_ID,

          categoria_id: opcoes.categoria_id ?? null,
          conta_id: opcoes.conta_id ?? null,
          cartao_id: opcoes.cartao_id ?? null,

          tipo: opcoes.tipo,

          descricao: opcoes.descricao ?? null,
          valor: opcoes.valor,
          data: this.formatarData(dataAtual),

          confirmado: opcoes.confirmado ?? false,

          fixo: true,
          frequencia: opcoes.frequencia,

          parcela_atual: null,
          parcela_total: null,

          grupo_parcelamento_id: null,
        });

        resultados.push(resultado);

        const proximaData = this.adicionarFrequencia(
          dataAtual,
          opcoes.frequencia
        );

        // Proteção contra qualquer frequência que não avance.
        if (proximaData <= dataAtual) {
          throw new Error(
            "Não foi possível avançar a data do lançamento fixo."
          );
        }

        dataAtual = proximaData;
      }

      await this.db.execute("COMMIT");

      return resultados;
    } catch (erro) {
      await this.db.execute("ROLLBACK");
      throw erro;
    }
  }

  // =====================================================================
  // INSERÇÃO DE LANÇAMENTO
  // =====================================================================

  /**
   * Insere UMA ocorrência no banco.
   *
   * Esse método é propositalmente separado da criação de parcelas/fixos.
   * Assim conseguimos garantir que cada ocorrência realmente exista
   * como uma linha independente.
   */
  private async inserirLancamento(
    dados: LancamentoBase
  ): Promise<LancamentoGerado> {
    const id = dados.id ?? this.gerarId();

    const data = this.parseData(dados.data);
    const dataISO = this.formatarData(data);

    let faturaId: string | null = null;

    // ---------------------------------------------------------------
    // CARTÃO DE CRÉDITO
    // ---------------------------------------------------------------

    if (dados.cartao_id) {
      const fatura = await this.obterOuCriarFatura(
        dados.cartao_id,
        dataISO
      );

      faturaId = fatura.id;
    }

    // ---------------------------------------------------------------
    // INSERÇÃO
    // ---------------------------------------------------------------

    await this.db.execute(
      `
      INSERT INTO lancamentos (
        id,
        usuario_id,

        categoria_id,
        conta_id,
        cartao_id,
        fatura_id,

        tipo,
        descricao,
        valor,
        data,

        confirmado,

        fixo,
        frequencia,

        parcela_atual,
        parcela_total,

        grupo_parcelamento_id
      )
      VALUES (
        ?,
        ?,

        ?,
        ?,
        ?,
        ?,

        ?,
        ?,
        ?,
        ?,

        ?,

        ?,
        ?,

        ?,
        ?,

        ?
      )
      `,
      [
        id,
        dados.usuario_id ?? USUARIO_LOCAL_ID,

        dados.categoria_id ?? null,
        dados.conta_id ?? null,
        dados.cartao_id ?? null,
        faturaId,

        dados.tipo,
        dados.descricao ?? null,
        dados.valor,
        dataISO,

        dados.confirmado ? 1 : 0,

        dados.fixo ? 1 : 0,
        dados.frequencia ?? null,

        dados.parcela_atual ?? null,
        dados.parcela_total ?? null,

        dados.grupo_parcelamento_id ?? null,
      ]
    );

    return {
      id,
      data: dataISO,
      parcela_atual: dados.parcela_atual ?? null,
      parcela_total: dados.parcela_total ?? null,
      fatura_id: faturaId,
    };
  }

  // =====================================================================
  // VALIDAÇÃO
  // =====================================================================

  private validarLancamento(
    opcoes: CriarLancamentoOpcoes
  ): void {
    if (!opcoes.tipo) {
      throw new Error(
        "O tipo do lançamento é obrigatório."
      );
    }

    if (
      opcoes.tipo !== "receita" &&
      opcoes.tipo !== "despesa"
    ) {
      throw new Error(
        "Tipo de lançamento inválido."
      );
    }

    if (
      typeof opcoes.valor !== "number" ||
      !Number.isFinite(opcoes.valor) ||
      opcoes.valor <= 0
    ) {
      throw new Error(
        "O valor do lançamento deve ser maior que zero."
      );
    }

    this.parseData(opcoes.data);

    if (
      opcoes.parcela_total !== null &&
      opcoes.parcela_total !== undefined
    ) {
      if (
        !Number.isInteger(opcoes.parcela_total) ||
        opcoes.parcela_total < 2
      ) {
        throw new Error(
          "A quantidade de parcelas deve ser um número inteiro maior ou igual a 2."
        );
      }
    }

    if (opcoes.fixo && opcoes.parcela_total) {
      throw new Error(
        "Um lançamento não pode ser fixo e parcelado ao mesmo tempo."
      );
    }

    if (
      opcoes.fixo &&
      !opcoes.frequencia
    ) {
      throw new Error(
        "Informe a frequência do lançamento fixo."
      );
    }
  }

  // =====================================================================
  // CONSULTAS DE LANÇAMENTOS
  // =====================================================================

  /**
   * Retorna todos os lançamentos do usuário.
   */
  async listarLancamentos(): Promise<any[]> {
    return this.query(
      `
      SELECT
        l.*,

        c.nome AS categoria_nome,
        c.icone AS categoria_icone,
        c.cor AS categoria_cor,

        co.nome AS conta_nome,
        co.icone AS conta_icone,
        co.cor AS conta_cor,

        cc.nome AS cartao_nome,
        cc.icone AS cartao_icone,
        cc.cor AS cartao_cor

      FROM lancamentos l

      LEFT JOIN categorias c
        ON c.id = l.categoria_id

      LEFT JOIN contas co
        ON co.id = l.conta_id

      LEFT JOIN cartoes_credito cc
        ON cc.id = l.cartao_id

      WHERE l.usuario_id = ?

      ORDER BY l.data DESC, l.id DESC
      `,
      [USUARIO_LOCAL_ID]
    );
  }

  /**
   * Busca um lançamento pelo ID.
   */
  async obterLancamento(
    id: string
  ): Promise<any | null> {
    const rows = await this.query(
      `
      SELECT *
      FROM lancamentos
      WHERE id = ?
        AND usuario_id = ?
      LIMIT 1
      `,
      [id, USUARIO_LOCAL_ID]
    );

    return rows.length
      ? rows[0]
      : null;
  }

  /**
   * Retorna todas as ocorrências de um parcelamento.
   */
  async listarParcelas(
    grupoParcelamentoId: string
  ): Promise<any[]> {
    return this.query(
      `
      SELECT *
      FROM lancamentos
      WHERE grupo_parcelamento_id = ?
        AND usuario_id = ?
      ORDER BY parcela_atual ASC, data ASC
      `,
      [
        grupoParcelamentoId,
        USUARIO_LOCAL_ID,
      ]
    );
  }

  /**
   * Retorna os lançamentos de uma fatura.
   */
  async listarLancamentosDaFatura(
    faturaId: string
  ): Promise<any[]> {
    return this.query(
      `
      SELECT
        l.*,

        c.nome AS categoria_nome,
        c.icone AS categoria_icone,
        c.cor AS categoria_cor

      FROM lancamentos l

      LEFT JOIN categorias c
        ON c.id = l.categoria_id

      WHERE l.fatura_id = ?
        AND l.usuario_id = ?

      ORDER BY l.data ASC, l.id ASC
      `,
      [
        faturaId,
        USUARIO_LOCAL_ID,
      ]
    );
  }

  // =====================================================================
  // ATUALIZAÇÃO / EXCLUSÃO
  // =====================================================================

  /**
   * Atualiza uma ocorrência individual.
   *
   * Importante:
   * Alterar uma parcela não recria automaticamente as demais.
   * Isso evita alterações acidentais em toda a série.
   */
  async atualizarLancamento(
    id: string,
    dados: Partial<LancamentoBase>
  ): Promise<void> {
    await this.init();

    const existente = await this.obterLancamento(id);

    if (!existente) {
      throw new Error(
        "Lançamento não encontrado."
      );
    }

    const campos: string[] = [];
    const valores: any[] = [];

    if (dados.categoria_id !== undefined) {
      campos.push("categoria_id = ?");
      valores.push(dados.categoria_id);
    }

    if (dados.conta_id !== undefined) {
      campos.push("conta_id = ?");
      valores.push(dados.conta_id);
    }

    if (dados.cartao_id !== undefined) {
      campos.push("cartao_id = ?");
      valores.push(dados.cartao_id);
    }

    if (dados.tipo !== undefined) {
      campos.push("tipo = ?");
      valores.push(dados.tipo);
    }

    if (dados.descricao !== undefined) {
      campos.push("descricao = ?");
      valores.push(dados.descricao);
    }

    if (dados.valor !== undefined) {
      if (
        typeof dados.valor !== "number" ||
        !Number.isFinite(dados.valor) ||
        dados.valor <= 0
      ) {
        throw new Error(
          "Valor inválido."
        );
      }

      campos.push("valor = ?");
      valores.push(dados.valor);
    }

    if (dados.data !== undefined) {
      const data = this.parseData(dados.data);

      campos.push("data = ?");
      valores.push(this.formatarData(data));
    }

    if (dados.confirmado !== undefined) {
      campos.push("confirmado = ?");
      valores.push(dados.confirmado ? 1 : 0);
    }

    // Se a origem (cartão) ou a data mudaram, a fatura correspondente
    // também pode ter mudado — recalcula sempre que um dos dois é tocado.
    if (dados.cartao_id !== undefined || dados.data !== undefined) {
      const cartaoIdFinal =
        dados.cartao_id !== undefined ? dados.cartao_id : existente.cartao_id;

      const dataFinalISO =
        dados.data !== undefined
          ? this.formatarData(this.parseData(dados.data))
          : existente.data;

      let faturaId: string | null = null;

      if (cartaoIdFinal) {
        const fatura = await this.obterOuCriarFatura(cartaoIdFinal, dataFinalISO);
        faturaId = fatura.id;
      }

      campos.push("fatura_id = ?");
      valores.push(faturaId);
    }

    if (!campos.length) {
      return;
    }

    valores.push(id);
    valores.push(USUARIO_LOCAL_ID);

    await this.db.execute(
      `
      UPDATE lancamentos
      SET ${campos.join(", ")}
      WHERE id = ?
        AND usuario_id = ?
      `,
      valores
    );
  }

  /**
   * Exclui somente uma ocorrência.
   */
  async excluirLancamento(
    id: string
  ): Promise<void> {
    await this.init();

    await this.db.execute(
      `
      DELETE FROM lancamentos
      WHERE id = ?
        AND usuario_id = ?
      `,
      [
        id,
        USUARIO_LOCAL_ID,
      ]
    );
  }

  /**
   * Exclui todas as parcelas pertencentes ao mesmo grupo.
   */
  async excluirParcelamento(
    grupoParcelamentoId: string
  ): Promise<void> {
    await this.init();

    await this.db.execute(
      `
      DELETE FROM lancamentos
      WHERE grupo_parcelamento_id = ?
        AND usuario_id = ?
      `,
      [
        grupoParcelamentoId,
        USUARIO_LOCAL_ID,
      ]
    );
  }

  // =====================================================================
  // FATURAS — SALDO ACUMULADO (saldo mês anterior / total / restante)
  // =====================================================================

  /**
   * Calcula, pra cada fatura de um cartão (em ordem cronológica), quanto
   * foi comprado no mês, quanto sobrou de saldo da fatura anterior, o
   * total devido, quanto já foi pago e quanto ainda falta.
   *
   * O "saldo mês anterior" nunca é guardado no banco — é sempre recalculado
   * a partir do histórico de pagamentos, então editar/excluir um pagamento
   * antigo já reflete automaticamente nas faturas seguintes.
   */
  private async calcularSaldosDoCartao(
    cartaoId: string
  ): Promise<Map<string, SaldoFatura>> {
    const faturas = await this.db.select(
      `
      SELECT id
      FROM faturas
      WHERE cartao_id = ?
      ORDER BY ano_referencia ASC, mes_referencia ASC
      `,
      [cartaoId]
    );

    const resultado = new Map<string, SaldoFatura>();

    let saldoAnterior = 0;

    for (const fatura of faturas) {
      const [faturaAtualRows, valorPagoRows] = await Promise.all([
        this.db.select(
          `SELECT COALESCE(SUM(valor), 0) AS total FROM lancamentos WHERE fatura_id = ?`,
          [fatura.id]
        ),
        this.db.select(
          `SELECT COALESCE(SUM(valor), 0) AS total FROM faturas_pagamentos WHERE fatura_id = ?`,
          [fatura.id]
        ),
      ]);

      const faturaAtual = Number(faturaAtualRows[0]?.total ?? 0);
      const valorPago = Number(valorPagoRows[0]?.total ?? 0);
      const valorTotal = faturaAtual + saldoAnterior;
      const valorRestante = Math.round((valorTotal - valorPago) * 100) / 100;

      resultado.set(fatura.id, {
        faturaAtual,
        saldoAnterior,
        valorTotal,
        valorPago,
        valorRestante,
      });

      saldoAnterior = valorRestante;
    }

    return resultado;
  }

  /**
   * Mês/ano de referência que uma compra feita hoje cairia, pro cartão
   * informado (mesma regra de dia_fechamento de obterOuCriarFatura).
   * Usado só pra saber se uma fatura é "a atual".
   */
  private calcularReferenciaAtual(
    diaFechamento: number
  ): { mes: number; ano: number } {
    const hoje = new Date();

    const dia = hoje.getDate();

    let mes = hoje.getMonth() + 1;
    let ano = hoje.getFullYear();

    if (dia > diaFechamento) {
      mes++;

      if (mes > 12) {
        mes = 1;
        ano++;
      }
    }

    return { mes, ano };
  }

  /**
   * Recalcula e grava faturas.status a partir do saldo acumulado
   * (não é a fonte da verdade — só um cache pra listagens simples).
   */
  private async recalcularStatusFatura(
    cartaoId: string,
    faturaId: string
  ): Promise<void> {
    const saldos = await this.calcularSaldosDoCartao(cartaoId);

    const saldo = saldos.get(faturaId);

    const status =
      saldo && saldo.valorTotal > 0 && saldo.valorRestante <= 0.01
        ? "paga"
        : "aberta";

    await this.db.execute(
      `UPDATE faturas SET status = ? WHERE id = ?`,
      [status, faturaId]
    );
  }

  // =====================================================================
  // FATURAS — CONSULTA
  // =====================================================================

  /**
   * Dados completos de uma fatura pra tela de Fatura: cartão, valores
   * (fatura do mês, saldo anterior, total, pago, restante), status atual/
   * paga e o histórico de pagamentos.
   */
  async obterFaturaDetalhada(
    faturaId: string
  ): Promise<FaturaDetalhada | null> {
    await this.init();

    const faturas = await this.db.select(
      `
      SELECT
        f.id, f.cartao_id, f.mes_referencia, f.ano_referencia,
        f.data_fechamento, f.data_vencimento, f.status,
        c.nome as cartao_nome, c.icone as cartao_icone, c.cor as cartao_cor,
        c.dia_fechamento, c.conta_pagamento_id
      FROM faturas f
      JOIN cartoes_credito c ON c.id = f.cartao_id
      WHERE f.id = ?
      LIMIT 1
      `,
      [faturaId]
    );

    if (!faturas.length) {
      return null;
    }

    const fatura = faturas[0];

    const saldos = await this.calcularSaldosDoCartao(fatura.cartao_id);
    const saldo = saldos.get(faturaId);

    if (!saldo) {
      return null;
    }

    const pagamentos = await this.listarPagamentosFatura(faturaId);

    const referenciaAtual = this.calcularReferenciaAtual(fatura.dia_fechamento);

    return {
      id: fatura.id,
      cartao_id: fatura.cartao_id,
      cartao_nome: fatura.cartao_nome,
      cartao_icone: fatura.cartao_icone,
      cartao_cor: fatura.cartao_cor,
      conta_pagamento_id: fatura.conta_pagamento_id,
      mes_referencia: fatura.mes_referencia,
      ano_referencia: fatura.ano_referencia,
      data_fechamento: fatura.data_fechamento,
      data_vencimento: fatura.data_vencimento,
      status: fatura.status,
      faturaAtual: saldo.faturaAtual,
      saldoAnterior: saldo.saldoAnterior,
      valorTotal: saldo.valorTotal,
      valorPago: saldo.valorPago,
      valorRestante: saldo.valorRestante,
      ehAtual:
        referenciaAtual.mes === fatura.mes_referencia &&
        referenciaAtual.ano === fatura.ano_referencia,
      ehPaga: saldo.valorTotal > 0 && saldo.valorRestante <= 0.01,
      pagamentos,
    };
  }

  /**
   * Faturas cujo vencimento cai num período (usado pela listagem de
   * Lançamentos pra montar a linha-resumo "Fatura {mês} {ano}" do mês).
   * Só devolve faturas com valor total diferente de zero.
   */
  async listarFaturasPorVencimento(
    dataInicio: string,
    dataFimExclusivo: string
  ): Promise<FaturaResumoPeriodo[]> {
    await this.init();

    const faturas = await this.db.select(
      `
      SELECT
        f.id, f.cartao_id, f.mes_referencia, f.ano_referencia, f.data_vencimento,
        c.nome as cartao_nome, c.icone as cartao_icone, c.cor as cartao_cor
      FROM faturas f
      JOIN cartoes_credito c ON c.id = f.cartao_id
      WHERE c.usuario_id = ?
        AND f.data_vencimento >= ?
        AND f.data_vencimento < ?
      ORDER BY f.data_vencimento ASC
      `,
      [USUARIO_LOCAL_ID, dataInicio, dataFimExclusivo]
    );

    const saldosPorCartao = new Map<string, Map<string, SaldoFatura>>();
    const resultado: FaturaResumoPeriodo[] = [];

    for (const fatura of faturas) {
      if (!saldosPorCartao.has(fatura.cartao_id)) {
        saldosPorCartao.set(
          fatura.cartao_id,
          await this.calcularSaldosDoCartao(fatura.cartao_id)
        );
      }

      const saldo = saldosPorCartao.get(fatura.cartao_id)!.get(fatura.id);
      const valorTotal = saldo ? saldo.valorTotal : 0;

      if (valorTotal !== 0) {
        resultado.push({
          id: fatura.id,
          cartao_id: fatura.cartao_id,
          cartao_nome: fatura.cartao_nome,
          cartao_icone: fatura.cartao_icone,
          cartao_cor: fatura.cartao_cor,
          mes_referencia: fatura.mes_referencia,
          ano_referencia: fatura.ano_referencia,
          data_vencimento: fatura.data_vencimento,
          valorTotal,
        });
      }
    }

    return resultado;
  }

  /**
   * Fatura anterior/próxima do mesmo cartão (pras setas de navegação da
   * tela de Fatura). Não cria fatura nenhuma — se não existir ainda
   * (porque não houve compra naquele mês), devolve null.
   */
  async obterFaturaAdjacente(
    cartaoId: string,
    mesReferencia: number,
    anoReferencia: number,
    direcao: "anterior" | "proxima"
  ): Promise<{ id: string } | null> {
    await this.init();

    const comparador = direcao === "anterior" ? "<" : ">";
    const ordem = direcao === "anterior" ? "DESC" : "ASC";

    const rows = await this.db.select(
      `
      SELECT id
      FROM faturas
      WHERE cartao_id = ?
        AND (
          ano_referencia ${comparador} ?
          OR (ano_referencia = ? AND mes_referencia ${comparador} ?)
        )
      ORDER BY ano_referencia ${ordem}, mes_referencia ${ordem}
      LIMIT 1
      `,
      [cartaoId, anoReferencia, anoReferencia, mesReferencia]
    );

    return rows.length ? { id: rows[0].id } : null;
  }

  // =====================================================================
  // FATURAS — PAGAMENTOS (parciais)
  // =====================================================================

  /**
   * Pagamentos já registrados de uma fatura, do mais antigo pro mais
   * novo, com o nome da conta usada em cada um.
   */
  async listarPagamentosFatura(
    faturaId: string
  ): Promise<PagamentoFatura[]> {
    await this.init();

    return this.db.select(
      `
      SELECT p.id, p.valor, p.data, p.conta_id, c.nome as conta_nome
      FROM faturas_pagamentos p
      LEFT JOIN contas c ON c.id = p.conta_id
      WHERE p.fatura_id = ?
      ORDER BY p.data ASC
      `,
      [faturaId]
    );
  }

  /**
   * Registra um pagamento (pode ser parcial) de uma fatura: cria o
   * lançamento de despesa na conta escolhida e a linha de pagamento,
   * e recalcula o status da fatura.
   */
  async registrarPagamentoFatura(
    faturaId: string,
    contaId: string | null,
    valor: number,
    data: string
  ): Promise<void> {
    await this.init();

    if (!(valor > 0)) {
      throw new Error("O valor do pagamento deve ser maior que zero.");
    }

    await this.db.execute("BEGIN TRANSACTION");

    try {
      const faturas = await this.db.select(
        `SELECT mes_referencia, ano_referencia, cartao_id FROM faturas WHERE id = ? LIMIT 1`,
        [faturaId]
      );

      if (!faturas.length) {
        throw new Error("Fatura não encontrada.");
      }

      const fatura = faturas[0];

      const lancamentoId = this.gerarId();

      await this.db.execute(
        `
        INSERT INTO lancamentos (
          id, usuario_id, conta_id, tipo, descricao, valor, data, confirmado
        )
        VALUES (?, ?, ?, 'despesa', ?, ?, ?, 1)
        `,
        [
          lancamentoId,
          USUARIO_LOCAL_ID,
          contaId,
          `Pagamento fatura ${String(fatura.mes_referencia).padStart(2, "0")}/${fatura.ano_referencia}`,
          valor,
          data,
        ]
      );

      await this.db.execute(
        `
        INSERT INTO faturas_pagamentos (id, fatura_id, lancamento_id, conta_id, valor, data)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [this.gerarId(), faturaId, lancamentoId, contaId, valor, data]
      );

      await this.recalcularStatusFatura(fatura.cartao_id, faturaId);

      await this.db.execute("COMMIT");
    } catch (erro) {
      await this.db.execute("ROLLBACK");
      throw erro;
    }
  }

  /**
   * Atualiza um pagamento já feito (valor/data/conta), refletindo tanto
   * na linha de pagamento quanto no lançamento de despesa vinculado.
   */
  async atualizarPagamentoFatura(
    pagamentoId: string,
    dados: { contaId?: string | null; valor?: number; data?: string }
  ): Promise<void> {
    await this.init();

    if (dados.valor !== undefined && !(dados.valor > 0)) {
      throw new Error("O valor do pagamento deve ser maior que zero.");
    }

    await this.db.execute("BEGIN TRANSACTION");

    try {
      const pagamentos = await this.db.select(
        `
        SELECT p.id, p.fatura_id, p.lancamento_id, f.cartao_id
        FROM faturas_pagamentos p
        JOIN faturas f ON f.id = p.fatura_id
        WHERE p.id = ?
        LIMIT 1
        `,
        [pagamentoId]
      );

      if (!pagamentos.length) {
        throw new Error("Pagamento não encontrado.");
      }

      const pagamento = pagamentos[0];

      const camposPagamento: string[] = [];
      const valoresPagamento: any[] = [];
      const camposLancamento: string[] = [];
      const valoresLancamento: any[] = [];

      if (dados.contaId !== undefined) {
        camposPagamento.push("conta_id = ?");
        valoresPagamento.push(dados.contaId);
        camposLancamento.push("conta_id = ?");
        valoresLancamento.push(dados.contaId);
      }

      if (dados.valor !== undefined) {
        camposPagamento.push("valor = ?");
        valoresPagamento.push(dados.valor);
        camposLancamento.push("valor = ?");
        valoresLancamento.push(dados.valor);
      }

      if (dados.data !== undefined) {
        camposPagamento.push("data = ?");
        valoresPagamento.push(dados.data);
        camposLancamento.push("data = ?");
        valoresLancamento.push(dados.data);
      }

      if (camposPagamento.length) {
        valoresPagamento.push(pagamentoId);

        await this.db.execute(
          `UPDATE faturas_pagamentos SET ${camposPagamento.join(", ")} WHERE id = ?`,
          valoresPagamento
        );
      }

      if (camposLancamento.length) {
        valoresLancamento.push(pagamento.lancamento_id);

        await this.db.execute(
          `UPDATE lancamentos SET ${camposLancamento.join(", ")} WHERE id = ?`,
          valoresLancamento
        );
      }

      await this.recalcularStatusFatura(pagamento.cartao_id, pagamento.fatura_id);

      await this.db.execute("COMMIT");
    } catch (erro) {
      await this.db.execute("ROLLBACK");
      throw erro;
    }
  }

  /**
   * Exclui um pagamento (e o lançamento de despesa vinculado a ele).
   */
  async excluirPagamentoFatura(pagamentoId: string): Promise<void> {
    await this.init();

    await this.db.execute("BEGIN TRANSACTION");

    try {
      const pagamentos = await this.db.select(
        `
        SELECT p.fatura_id, p.lancamento_id, f.cartao_id
        FROM faturas_pagamentos p
        JOIN faturas f ON f.id = p.fatura_id
        WHERE p.id = ?
        LIMIT 1
        `,
        [pagamentoId]
      );

      if (!pagamentos.length) {
        await this.db.execute("COMMIT");
        return;
      }

      const pagamento = pagamentos[0];

      await this.db.execute(`DELETE FROM faturas_pagamentos WHERE id = ?`, [pagamentoId]);
      await this.db.execute(`DELETE FROM lancamentos WHERE id = ?`, [pagamento.lancamento_id]);

      await this.recalcularStatusFatura(pagamento.cartao_id, pagamento.fatura_id);

      await this.db.execute("COMMIT");
    } catch (erro) {
      await this.db.execute("ROLLBACK");
      throw erro;
    }
  }

  // =====================================================================
  // CONTAS
  // =====================================================================

  /**
   * Calcula o saldo atual de uma conta.
   *
   * Receita aumenta.
   * Despesa diminui.
   *
   * Lançamentos não confirmados continuam fora do saldo.
   */
  async obterSaldoConta(
    contaId: string
  ): Promise<number> {
    const rows = await this.query(
      `
      SELECT
        c.saldo_inicial
        +
        COALESCE(
          SUM(
            CASE
              WHEN l.tipo = 'receita'
                THEN l.valor

              WHEN l.tipo = 'despesa'
                THEN -l.valor

              ELSE 0
            END
          ),
          0
        ) AS saldo

      FROM contas c

      LEFT JOIN lancamentos l
        ON l.conta_id = c.id
        AND l.confirmado = 1

      WHERE c.id = ?
        AND c.usuario_id = ?

      GROUP BY
        c.id,
        c.saldo_inicial
      `,
      [
        contaId,
        USUARIO_LOCAL_ID,
      ]
    );

    return Number(
      rows[0]?.saldo ?? 0
    );
  }

  // =====================================================================
  // DASHBOARD / TOTAIS
  // =====================================================================

  /**
   * Total de receitas em um período.
   */
  async obterTotalReceitas(
    dataInicio: string,
    dataFim: string
  ): Promise<number> {
    const rows = await this.query(
      `
      SELECT
        COALESCE(SUM(valor), 0) AS total
      FROM lancamentos
      WHERE usuario_id = ?
        AND tipo = 'receita'
        AND data BETWEEN ? AND ?
      `,
      [
        USUARIO_LOCAL_ID,
        dataInicio,
        dataFim,
      ]
    );

    return Number(
      rows[0]?.total ?? 0
    );
  }

  /**
   * Total de despesas em um período.
   */
  async obterTotalDespesas(
    dataInicio: string,
    dataFim: string
  ): Promise<number> {
    const rows = await this.query(
      `
      SELECT
        COALESCE(SUM(valor), 0) AS total
      FROM lancamentos
      WHERE usuario_id = ?
        AND tipo = 'despesa'
        AND data BETWEEN ? AND ?
      `,
      [
        USUARIO_LOCAL_ID,
        dataInicio,
        dataFim,
      ]
    );

    return Number(
      rows[0]?.total ?? 0
    );
  }

  /**
   * Saldo do período:
   * receitas - despesas.
   */
  async obterSaldoPeriodo(
    dataInicio: string,
    dataFim: string
  ): Promise<number> {
    const rows = await this.query(
      `
      SELECT
        COALESCE(
          SUM(
            CASE
              WHEN tipo = 'receita'
                THEN valor

              WHEN tipo = 'despesa'
                THEN -valor

              ELSE 0
            END
          ),
          0
        ) AS saldo

      FROM lancamentos

      WHERE usuario_id = ?
        AND data BETWEEN ? AND ?
      `,
      [
        USUARIO_LOCAL_ID,
        dataInicio,
        dataFim,
      ]
    );

    return Number(
      rows[0]?.saldo ?? 0
    );
  }

  // =====================================================================
  // EDIÇÃO / EXCLUSÃO COM ESCOPO (grupos de repetição: fixo ou parcelado)
  // =====================================================================

  /**
   * Atualiza um lançamento respeitando o escopo escolhido:
   * - "atual": só essa ocorrência (comportamento de sempre).
   * - "atual_e_proximos": essa ocorrência + as futuras do mesmo grupo,
   *   recriando as datas a partir daqui (útil pra mudar frequência/parcelas).
   * - "todos": todas as ocorrências do grupo, passadas e futuras.
   *
   * Se o lançamento não pertencer a um grupo (não é fixo nem parcelado),
   * o escopo é ignorado e só essa linha é alterada.
   */
  async atualizarLancamentoComEscopo(
    id: string,
    alteracoes: AlteracoesLancamento,
    escopo: EscopoEdicao
  ): Promise<void> {
    await this.init();

    const atual = await this.obterLancamento(id);
    if (!atual) {
      throw new Error("Lançamento não encontrado.");
    }

    if (!atual.grupo_parcelamento_id || escopo === "atual") {
      await this.atualizarLancamento(id, {
        descricao: alteracoes.descricao,
        valor: alteracoes.valor,
        data: alteracoes.data,
        conta_id: alteracoes.conta_id,
        cartao_id: alteracoes.cartao_id,
        categoria_id: alteracoes.categoria_id,
        confirmado: alteracoes.confirmado,
      });
      return;
    }

    const linhasGrupo = await this.listarParcelas(atual.grupo_parcelamento_id);

    if (atual.fixo === 1) {
      await this.atualizarGrupoFixo(atual, linhasGrupo, alteracoes, escopo);
    } else {
      await this.atualizarGrupoParcelado(atual, linhasGrupo, alteracoes, escopo);
    }
  }

  private async atualizarGrupoFixo(
    atual: any,
    linhasGrupo: any[],
    alteracoes: AlteracoesLancamento,
    escopo: EscopoEdicao
  ): Promise<void> {
    const novaFrequencia: FrequenciaLancamento = alteracoes.frequencia ?? atual.frequencia;

    const camposComuns = {
      descricao: alteracoes.descricao ?? atual.descricao,
      valor: alteracoes.valor ?? atual.valor,
      categoria_id: alteracoes.categoria_id !== undefined ? alteracoes.categoria_id : atual.categoria_id,
      conta_id: alteracoes.conta_id !== undefined ? alteracoes.conta_id : atual.conta_id,
      cartao_id: alteracoes.cartao_id !== undefined ? alteracoes.cartao_id : atual.cartao_id,
    };

    // ---------------------------------------------------------------
    // ATUAL E PRÓXIMOS: apaga as ocorrências futuras (>= data desta)
    // e recria a partir daqui com a frequência (nova ou mantida).
    // ---------------------------------------------------------------
    if (escopo === "atual_e_proximos") {
      const afetadas = linhasGrupo.filter((l) => l.data >= atual.data);
      const dataInicial = this.parseData(alteracoes.data ?? atual.data);

      await this.db.execute("BEGIN TRANSACTION");
      try {
        for (const l of afetadas) {
          await this.db.execute("DELETE FROM lancamentos WHERE id = ?", [l.id]);
        }

        let dataAtual = dataInicial;
        for (let i = 0; i < afetadas.length; i++) {
          await this.inserirLancamento({
            usuario_id: USUARIO_LOCAL_ID,
            ...camposComuns,
            tipo: atual.tipo,
            data: this.formatarData(dataAtual),
            confirmado: i === 0 ? alteracoes.confirmado ?? atual.confirmado === 1 : false,
            fixo: true,
            frequencia: novaFrequencia,
            parcela_atual: null,
            parcela_total: null,
            grupo_parcelamento_id: atual.grupo_parcelamento_id,
          });
          dataAtual = this.adicionarFrequencia(dataAtual, novaFrequencia);
        }

        await this.db.execute("COMMIT");
      } catch (erro) {
        await this.db.execute("ROLLBACK");
        throw erro;
      }
      return;
    }

    // ---------------------------------------------------------------
    // TODOS: se a frequência mudou, recria toda a série a partir da
    // primeira data original; senão só atualiza os campos comuns
    // de cada linha, preservando a data de cada ocorrência.
    // ---------------------------------------------------------------
    if (novaFrequencia !== atual.frequencia) {
      const primeira = linhasGrupo[0];

      await this.db.execute("BEGIN TRANSACTION");
      try {
        for (const l of linhasGrupo) {
          await this.db.execute("DELETE FROM lancamentos WHERE id = ?", [l.id]);
        }

        let dataAtual = this.parseData(primeira.data);
        for (let i = 0; i < linhasGrupo.length; i++) {
          await this.inserirLancamento({
            usuario_id: USUARIO_LOCAL_ID,
            ...camposComuns,
            tipo: atual.tipo,
            data: this.formatarData(dataAtual),
            confirmado: false,
            fixo: true,
            frequencia: novaFrequencia,
            parcela_atual: null,
            parcela_total: null,
            grupo_parcelamento_id: atual.grupo_parcelamento_id,
          });
          dataAtual = this.adicionarFrequencia(dataAtual, novaFrequencia);
        }

        await this.db.execute("COMMIT");
      } catch (erro) {
        await this.db.execute("ROLLBACK");
        throw erro;
      }
      return;
    }

    await this.db.execute("BEGIN TRANSACTION");
    try {
      for (const l of linhasGrupo) {
        let faturaId: string | null = null;
        if (camposComuns.cartao_id) {
          const fatura = await this.obterOuCriarFatura(camposComuns.cartao_id, l.data);
          faturaId = fatura.id;
        }

        await this.db.execute(
          `UPDATE lancamentos
           SET descricao = ?, valor = ?, categoria_id = ?, conta_id = ?, cartao_id = ?, fatura_id = ?
           WHERE id = ?`,
          [
            camposComuns.descricao,
            camposComuns.valor,
            camposComuns.categoria_id,
            camposComuns.conta_id,
            camposComuns.cartao_id,
            faturaId,
            l.id,
          ]
        );
      }
      await this.db.execute("COMMIT");
    } catch (erro) {
      await this.db.execute("ROLLBACK");
      throw erro;
    }
  }

  private async atualizarGrupoParcelado(
    atual: any,
    linhasGrupo: any[],
    alteracoes: AlteracoesLancamento,
    escopo: EscopoEdicao
  ): Promise<void> {
    const camposComuns = {
      descricao: alteracoes.descricao ?? atual.descricao,
      categoria_id: alteracoes.categoria_id !== undefined ? alteracoes.categoria_id : atual.categoria_id,
      conta_id: alteracoes.conta_id !== undefined ? alteracoes.conta_id : atual.conta_id,
      cartao_id: alteracoes.cartao_id !== undefined ? alteracoes.cartao_id : atual.cartao_id,
    };
    const valorParcela = alteracoes.valor ?? atual.valor;

    // ---------------------------------------------------------------
    // ATUAL E PRÓXIMOS: apaga as parcelas futuras (parcela_atual >= esta)
    // e recria com a nova quantidade a partir daqui. As parcelas
    // anteriores ficam intactas, só ganham o parcela_total atualizado.
    // ---------------------------------------------------------------
    if (escopo === "atual_e_proximos") {
      const anteriores = linhasGrupo.filter((l) => l.parcela_atual < atual.parcela_atual);
      const afetadas = linhasGrupo.filter((l) => l.parcela_atual >= atual.parcela_atual);
      const novaQuantidadeFutura = alteracoes.parcela_total ?? afetadas.length;
      const novoTotalGeral = anteriores.length + novaQuantidadeFutura;

      await this.db.execute("BEGIN TRANSACTION");
      try {
        for (const l of afetadas) {
          await this.db.execute("DELETE FROM lancamentos WHERE id = ?", [l.id]);
        }

        let dataAtual = this.parseData(alteracoes.data ?? atual.data);
        for (let i = 0; i < novaQuantidadeFutura; i++) {
          await this.inserirLancamento({
            usuario_id: USUARIO_LOCAL_ID,
            ...camposComuns,
            tipo: atual.tipo,
            valor: valorParcela,
            data: this.formatarData(dataAtual),
            confirmado: i === 0 ? alteracoes.confirmado ?? atual.confirmado === 1 : false,
            fixo: false,
            frequencia: null,
            parcela_atual: anteriores.length + i + 1,
            parcela_total: novoTotalGeral,
            grupo_parcelamento_id: atual.grupo_parcelamento_id,
          });
          dataAtual = this.adicionarMeses(dataAtual, 1);
        }

        if (anteriores.length) {
          await this.db.execute(
            "UPDATE lancamentos SET parcela_total = ? WHERE grupo_parcelamento_id = ? AND parcela_atual < ?",
            [novoTotalGeral, atual.grupo_parcelamento_id, atual.parcela_atual]
          );
        }

        await this.db.execute("COMMIT");
      } catch (erro) {
        await this.db.execute("ROLLBACK");
        throw erro;
      }
      return;
    }

    // ---------------------------------------------------------------
    // TODOS: reconstrói a série inteira a partir da primeira data
    // original, com a nova quantidade de parcelas (se informada).
    // ---------------------------------------------------------------
    const novaQuantidade = alteracoes.parcela_total ?? linhasGrupo.length;
    const primeira = linhasGrupo[0];

    await this.db.execute("BEGIN TRANSACTION");
    try {
      for (const l of linhasGrupo) {
        await this.db.execute("DELETE FROM lancamentos WHERE id = ?", [l.id]);
      }

      let dataAtual = this.parseData(primeira.data);
      for (let i = 0; i < novaQuantidade; i++) {
        await this.inserirLancamento({
          usuario_id: USUARIO_LOCAL_ID,
          ...camposComuns,
          tipo: atual.tipo,
          valor: valorParcela,
          data: this.formatarData(dataAtual),
          confirmado: false,
          fixo: false,
          frequencia: null,
          parcela_atual: i + 1,
          parcela_total: novaQuantidade,
          grupo_parcelamento_id: atual.grupo_parcelamento_id,
        });
        dataAtual = this.adicionarMeses(dataAtual, 1);
      }

      await this.db.execute("COMMIT");
    } catch (erro) {
      await this.db.execute("ROLLBACK");
      throw erro;
    }
  }

  /**
   * Exclui um lançamento respeitando o escopo escolhido, igual à edição:
   * - "atual": só essa ocorrência.
   * - "atual_e_proximos": essa e as futuras do mesmo grupo.
   * - "todos": o grupo inteiro.
   */
  async excluirLancamentoComEscopo(id: string, escopo: EscopoEdicao): Promise<void> {
    await this.init();

    const atual = await this.obterLancamento(id);
    if (!atual) return;

    if (!atual.grupo_parcelamento_id || escopo === "atual") {
      await this.excluirLancamento(id);
      return;
    }

    if (escopo === "todos") {
      await this.excluirParcelamento(atual.grupo_parcelamento_id);
      return;
    }

    // atual_e_proximos
    if (atual.fixo === 1) {
      await this.db.execute(
        "DELETE FROM lancamentos WHERE grupo_parcelamento_id = ? AND data >= ? AND usuario_id = ?",
        [atual.grupo_parcelamento_id, atual.data, USUARIO_LOCAL_ID]
      );
      return;
    }

    await this.db.execute(
      "DELETE FROM lancamentos WHERE grupo_parcelamento_id = ? AND parcela_atual >= ? AND usuario_id = ?",
      [atual.grupo_parcelamento_id, atual.parcela_atual, USUARIO_LOCAL_ID]
    );

    const restantes = atual.parcela_atual - 1;
    if (restantes > 0) {
      await this.db.execute("UPDATE lancamentos SET parcela_total = ? WHERE grupo_parcelamento_id = ?", [
        restantes,
        atual.grupo_parcelamento_id,
      ]);
    }
  }

  // =====================================================================
  // OBSERVAÇÃO
  // =====================================================================

  /**
   * Salva (ou limpa, se null) a observação de UMA ocorrência específica.
   * Independente do escopo de edição do grupo, a observação é sempre
   * por ocorrência.
   */
  async salvarObservacao(lancamentoId: string, observacao: string | null): Promise<void> {
    await this.init();

    await this.db.execute(
      `UPDATE lancamentos SET observacao = ? WHERE id = ? AND usuario_id = ?`,
      [observacao && observacao.trim() ? observacao.trim() : null, lancamentoId, USUARIO_LOCAL_ID]
    );
  }

  // =====================================================================
  // TAGS DO LANÇAMENTO
  // =====================================================================

  /**
   * Substitui todas as tags de um lançamento pela lista informada
   * (apaga as antigas e insere as novas).
   */
  async salvarTagsDoLancamento(lancamentoId: string, tagIds: string[]): Promise<void> {
    await this.init();

    await this.db.execute("DELETE FROM lancamentos_tags WHERE lancamento_id = ?", [lancamentoId]);

    for (const tagId of tagIds) {
      await this.db.execute(
        `INSERT OR IGNORE INTO lancamentos_tags (lancamento_id, tag_id) VALUES (?, ?)`,
        [lancamentoId, tagId]
      );
    }
  }

  /**
   * Retorna as tags (id + nome) de um único lançamento.
   */
  async obterTagsDoLancamento(lancamentoId: string): Promise<{ id: string; nome: string }[]> {
    await this.init();

    return this.db.select(
      `
      SELECT t.id, t.nome
      FROM lancamentos_tags lt
      JOIN tags t ON t.id = lt.tag_id
      WHERE lt.lancamento_id = ?
      ORDER BY t.nome
      `,
      [lancamentoId]
    );
  }

  /**
   * Retorna as tags de vários lançamentos de uma vez, já agrupadas por
   * lancamento_id. Usado na listagem para não fazer 1 query por linha.
   */
  async obterTagsPorLancamentos(
    lancamentoIds: string[]
  ): Promise<Record<string, { id: string; nome: string }[]>> {
    await this.init();

    const resultado: Record<string, { id: string; nome: string }[]> = {};
    if (!lancamentoIds.length) return resultado;

    const placeholders = lancamentoIds.map(() => "?").join(",");

    const linhas = await this.db.select(
      `
      SELECT lt.lancamento_id, t.id, t.nome
      FROM lancamentos_tags lt
      JOIN tags t ON t.id = lt.tag_id
      WHERE lt.lancamento_id IN (${placeholders})
      ORDER BY t.nome
      `,
      lancamentoIds
    );

    for (const linha of linhas) {
      if (!resultado[linha.lancamento_id]) {
        resultado[linha.lancamento_id] = [];
      }
      resultado[linha.lancamento_id].push({ id: linha.id, nome: linha.nome });
    }

    return resultado;
  }

  // =====================================================================
  // ANEXOS DO LANÇAMENTO
  // =====================================================================

  /**
   * Salva um anexo (o conteúdo já deve vir em base64, sem o prefixo
   * "data:...;base64,"). Retorna o id gerado.
   */
  async adicionarAnexo(
    lancamentoId: string,
    nome: string,
    tipo: string,
    tamanho: number,
    conteudoBase64: string
  ): Promise<string> {
    await this.init();

    const id = this.gerarId();

    await this.db.execute(
      `INSERT INTO lancamentos_anexos (id, lancamento_id, nome, tipo, tamanho, conteudo)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, lancamentoId, nome, tipo || null, tamanho, conteudoBase64]
    );

    return id;
  }

  /**
   * Lista os anexos de um lançamento (sem o conteúdo, só metadados —
   * mais leve para exibir na tela).
   */
  async listarAnexos(
    lancamentoId: string
  ): Promise<{ id: string; nome: string; tipo: string | null; tamanho: number }[]> {
    await this.init();

    return this.db.select(
      `SELECT id, nome, tipo, tamanho FROM lancamentos_anexos WHERE lancamento_id = ? ORDER BY rowid`,
      [lancamentoId]
    );
  }

  /**
   * Retorna quantos anexos cada lançamento (de uma lista) possui.
   * Usado na listagem para mostrar o ícone de anexo sem 1 query por linha.
   */
  async contarAnexosPorLancamentos(lancamentoIds: string[]): Promise<Record<string, number>> {
    await this.init();

    const resultado: Record<string, number> = {};
    if (!lancamentoIds.length) return resultado;

    const placeholders = lancamentoIds.map(() => "?").join(",");

    const linhas = await this.db.select(
      `
      SELECT lancamento_id, COUNT(*) as total
      FROM lancamentos_anexos
      WHERE lancamento_id IN (${placeholders})
      GROUP BY lancamento_id
      `,
      lancamentoIds
    );

    for (const linha of linhas) {
      resultado[linha.lancamento_id] = Number(linha.total);
    }

    return resultado;
  }

  /**
   * Remove um anexo pelo id.
   */
  async removerAnexo(anexoId: string): Promise<void> {
    await this.init();

    await this.db.execute(`DELETE FROM lancamentos_anexos WHERE id = ?`, [anexoId]);
  }
}