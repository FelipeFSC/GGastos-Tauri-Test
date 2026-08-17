import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { DatabaseService, USUARIO_LOCAL_ID } from "../../services/database.service";
import { BancoSeletorComponent } from "../../shared/banco-seletor/banco-seletor.component";

type TipoExtrato = "cartao" | "banco";

interface Categoria {
    id: string;
    nome: string;
    icone?: string | null;
    cor?: string | null;
    categoria_pai_id?: string | null;
}

interface Conta {
    id: string;
    nome: string;
}

interface Cartao {
    id: string;
    nome: string;
}

interface LinhaImportada {
    /** Id só de UI (nada disso existe no banco ainda). */
    id: string;

    /** Texto original da coluna "title" do CSV, exatamente como veio. */
    tituloOriginal: string;

    /**
     * Título sem o sufixo "- Parcela N/M" (quando existir) — é essa
     * versão "limpa" que vira a chave da regra de importação, senão o
     * usuário teria que configurar de novo todo mês, já que a parcela
     * muda a cada extrato.
     */
    chaveRegra: string;

    /** Descrição editável pelo usuário (começa igual à chave/regra). */
    descricao: string;

    data: string;
    valor: number;
    tipo: "receita" | "despesa";

    categoriaId: string | null;

    /** "" | "conta:<id>" | "cartao:<id>" — mesmo formato usado no modal de lançamento. */
    origem: string;

    /** Número da parcela detectado no título original (ex.: "Parcela 6/12" => 6/12). */
    parcelaAtualDetectada: number | null;
    parcelaTotalDetectada: number | null;

    /**
     * Decisão do usuário sobre o item parcelado detectado. `null` quando
     * não foi detectado nenhum parcelamento nesse título (nesse caso a
     * linha sempre sobe como um lançamento único).
     */
    modoParcelamento: "unitario" | "parcelas" | null;

    /** Só usados quando modoParcelamento === "parcelas". */
    quantidadeParcelas: number | null;
    parcelaAtual: number | null;
    valorTotalParcelamento: number | null;

    /**
     * true quando esse título já teve uma série de parcelas completa
     * enviada antes (mesma quantidade total detectada) — a linha só é
     * mostrada como referência, não é configurável nem entra no export.
     */
    jaImportada: boolean;
}

interface GrupoImportado {
    data: string;
    dia: number;
    itens: LinhaImportada[];
}

interface FormLinha {
    descricao: string;
    categoriaId: string;
    origem: string;
    modoParcelamento: "unitario" | "parcelas";
    quantidadeParcelas: number;
    parcelaAtual: number;
    valorTotalParcelamento: number;
}

/**
 * Tela de importação de extrato via CSV — atende tanto o extrato de
 * CARTÃO (date,title,amount) quanto o de CONTA bancária
 * (Data,Valor,Identificador,Descrição); qual dos dois é decidido pela
 * rota (`data: { tipoExtrato }`, ver app.routes.ts). A lógica —
 * pré-preencher por regra salva, configurar descrição/categoria/conta
 * ou cartão linha a linha, detectar parcelamento, exportar — é toda
 * compartilhada; só o parser do CSV (e o tipo receita/despesa de cada
 * linha) muda conforme o formato.
 *
 * Não fica no menu principal — só é acessível pelo botão "Mais opções"
 * da tela de Lançamentos.
 *
 * Fluxo: escolhe o banco → sobe o arquivo → lista os lançamentos
 * encontrados → o usuário clica em cada um pra definir descrição/
 * categoria/conta ou cartão → essa escolha é lembrada por título
 * original (tabela `regras_importacao`), então da próxima vez que o
 * mesmo título aparecer ele já vem pré-preenchido → só depois de tudo
 * configurado é que "Exportar" grava os lançamentos de verdade.
 */
@Component({
    selector: "app-importar-csv",
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, BancoSeletorComponent],
    templateUrl: "./importar-csv.component.html",
    styleUrl: "./importar-csv.component.css",
})
export class ImportarCsvComponent implements OnInit {
    tipoExtrato: TipoExtrato = "cartao";

    bancoSelecionado: string | null = null;

    categorias: Categoria[] = [];
    contas: Conta[] = [];
    cartoes: Cartao[] = [];

    arrastando = false;
    carregando = false;
    exportando = false;

    erro: string | null = null;
    sucesso: string | null = null;

    nomeArquivo: string | null = null;
    linhas: LinhaImportada[] = [];
    grupos: GrupoImportado[] = [];

    linhaEmEdicao: LinhaImportada | null = null;
    formEdicao: FormLinha = {
        descricao: "",
        categoriaId: "",
        origem: "",
        modoParcelamento: "unitario",
        quantidadeParcelas: 2,
        parcelaAtual: 1,
        valorTotalParcelamento: 0,
    };

    constructor(
        private db: DatabaseService,
        private route: ActivatedRoute,
    ) { }

    async ngOnInit(): Promise<void> {
        this.tipoExtrato =
            (this.route.snapshot.data["tipoExtrato"] as TipoExtrato) || "cartao";

        this.categorias = await this.db.query<Categoria>(
            `SELECT * FROM categorias WHERE usuario_id = ? ORDER BY nome`,
            [USUARIO_LOCAL_ID],
        );

        this.contas = await this.db.query<Conta>(
            `SELECT id, nome FROM contas WHERE usuario_id = ? ORDER BY nome`,
            [USUARIO_LOCAL_ID],
        );

        this.cartoes = await this.db.query<Cartao>(
            `SELECT id, nome FROM cartoes_credito WHERE usuario_id = ? ORDER BY nome`,
            [USUARIO_LOCAL_ID],
        );
    }

    // =====================================================================
    // UPLOAD (clique ou arrastar-e-soltar)
    // =====================================================================

    onDragOver(event: DragEvent): void {
        event.preventDefault();
        this.arrastando = true;
    }

    onDragLeave(event: DragEvent): void {
        event.preventDefault();
        this.arrastando = false;
    }

    onDrop(event: DragEvent): void {
        event.preventDefault();
        this.arrastando = false;

        const arquivo = event.dataTransfer?.files?.[0];

        if (arquivo) {
            this.processarArquivo(arquivo);
        }
    }

    onArquivoSelecionado(event: Event): void {
        const input = event.target as HTMLInputElement;
        const arquivo = input.files?.[0];

        if (arquivo) {
            this.processarArquivo(arquivo);
        }

        // Limpa o input pra poder selecionar o mesmo arquivo de novo depois.
        input.value = "";
    }

    private async processarArquivo(arquivo: File): Promise<void> {
        this.erro = null;
        this.sucesso = null;

        if (!arquivo.name.toLowerCase().endsWith(".csv")) {
            this.erro = "Selecione um arquivo .csv.";
            return;
        }

        this.carregando = true;
        this.nomeArquivo = arquivo.name;

        try {
            const conteudo = await arquivo.text();

            const brutas =
                this.tipoExtrato === "banco"
                    ? this.parseCsvBanco(conteudo)
                    : this.parseCsvCartao(conteudo);

            const regras = await this.db.obterRegrasImportacao();

            this.linhas = brutas.map((bruta) => {
                const parcela = this.detectarParcela(bruta.tituloOriginal);
                const chaveRegra = parcela ? parcela.chave : bruta.tituloOriginal;

                const regra = regras[chaveRegra];

                const origem = regra?.conta_id
                    ? `conta:${regra.conta_id}`
                    : regra?.cartao_id
                        ? `cartao:${regra.cartao_id}`
                        : "";

                // A série de parcelas desse título já foi enviada por
                // inteiro antes (mesma quantidade) — essa parcela é só
                // informativa, não precisa (e não deve) subir de novo.
                const jaImportada = !!(
                    parcela &&
                    regra?.serie_parcelas_total === parcela.total
                );

                return {
                    id: this.gerarIdLocal(),
                    tituloOriginal: bruta.tituloOriginal,
                    chaveRegra,
                    descricao: regra?.descricao || chaveRegra,
                    data: bruta.data,
                    valor: bruta.valor,
                    tipo: bruta.tipo,
                    categoriaId: regra?.categoria_id ?? null,
                    origem,

                    parcelaAtualDetectada: parcela?.atual ?? null,
                    parcelaTotalDetectada: parcela?.total ?? null,

                    // Padrão sempre "unitário": subir a série inteira é uma
                    // decisão consciente do usuário (evita duplicar parcelas
                    // já importadas em meses anteriores).
                    modoParcelamento: parcela ? "unitario" : null,
                    quantidadeParcelas: parcela?.total ?? null,
                    parcelaAtual: parcela?.atual ?? null,
                    valorTotalParcelamento: parcela
                        ? Math.round(bruta.valor * parcela.total * 100) / 100
                        : null,

                    jaImportada,
                };
            });

            if (!this.linhas.length) {
                this.erro = "Nenhum lançamento encontrado nesse arquivo.";
            }

            this.organizarPorDia();
        } catch (erro) {
            console.error("Erro ao ler CSV:", erro);

            this.erro =
                erro instanceof Error
                    ? erro.message
                    : "Não foi possível ler o arquivo.";

            this.linhas = [];
            this.grupos = [];
        } finally {
            this.carregando = false;
        }
    }

    // =====================================================================
    // CSV (formato Nubank: date,title,amount — amount em "1.234,56")
    // =====================================================================

    private parseLinhaCsv(linha: string): string[] {
        const campos: string[] = [];

        let atual = "";
        let dentroDeAspas = false;

        for (let i = 0; i < linha.length; i++) {
            const char = linha[i];

            if (dentroDeAspas) {
                if (char === '"') {
                    if (linha[i + 1] === '"') {
                        atual += '"';
                        i++;
                    } else {
                        dentroDeAspas = false;
                    }
                } else {
                    atual += char;
                }
            } else if (char === '"') {
                dentroDeAspas = true;
            } else if (char === ",") {
                campos.push(atual);
                atual = "";
            } else {
                atual += char;
            }
        }

        campos.push(atual);

        return campos;
    }

    /**
     * Detecta o sufixo "- Parcela N/M" no título (ex.: "Amazonmktplc*Gabrielle
     * - Parcela 6/12") e devolve o título sem esse sufixo junto com o
     * número da parcela e o total.
     */
    private detectarParcela(
        titulo: string,
    ): { chave: string; atual: number; total: number } | null {
        const match = titulo.match(/\s*-\s*Parcela\s+(\d+)\s*\/\s*(\d+)\s*$/i);

        if (!match || match.index === undefined) {
            return null;
        }

        const atual = Number(match[1]);
        const total = Number(match[2]);

        if (
            !Number.isFinite(atual) ||
            !Number.isFinite(total) ||
            total < 2 ||
            atual < 1 ||
            atual > total
        ) {
            return null;
        }

        return {
            chave: titulo.slice(0, match.index).trim(),
            atual,
            total,
        };
    }

    private parseValor(valorTexto: string): number {
        const normalizado = valorTexto
            .trim()
            .replace(/\./g, "")
            .replace(",", ".");

        return Number(normalizado);
    }

    /** "01/08/2026" => "2026-08-01" (formato usado no resto do sistema). */
    private parseDataBanco(dataTexto: string): string | null {
        const match = dataTexto.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

        if (!match) {
            return null;
        }

        const [, dia, mes, ano] = match;

        return `${ano}-${mes}-${dia}`;
    }

    /** Extrato de CARTÃO: colunas date,title,amount — amount em "1.234,56". */
    private parseCsvCartao(
        conteudo: string,
    ): { data: string; tituloOriginal: string; valor: number; tipo: "receita" | "despesa" }[] {
        const linhas = conteudo
            .split(/\r\n|\n/)
            .map((l) => l.trim())
            .filter((l) => l.length > 0);

        if (linhas.length < 2) {
            return [];
        }

        const cabecalho = this.parseLinhaCsv(linhas[0]).map((c) =>
            c.trim().toLowerCase(),
        );

        const idxData = cabecalho.indexOf("date");
        const idxTitulo = cabecalho.indexOf("title");
        const idxValor = cabecalho.indexOf("amount");

        if (idxData === -1 || idxTitulo === -1 || idxValor === -1) {
            throw new Error(
                "Colunas esperadas não encontradas (date, title, amount).",
            );
        }

        const resultado: { data: string; tituloOriginal: string; valor: number; tipo: "receita" | "despesa" }[] = [];

        for (let i = 1; i < linhas.length; i++) {
            const campos = this.parseLinhaCsv(linhas[i]);

            const data = (campos[idxData] || "").trim();
            const tituloOriginal = (campos[idxTitulo] || "").trim();
            const valor = this.parseValor(campos[idxValor] || "");

            if (
                !/^\d{4}-\d{2}-\d{2}$/.test(data) ||
                !tituloOriginal ||
                !Number.isFinite(valor)
            ) {
                continue;
            }

            // Extrato de cartão só lista compras — sempre despesa.
            resultado.push({ data, tituloOriginal, valor, tipo: "despesa" });
        }

        return resultado.sort((a, b) => a.data.localeCompare(b.data));
    }

    /**
     * Extrato de CONTA bancária: colunas Data,Valor,Identificador,Descrição
     * — data em DD/MM/AAAA, valor com ponto decimal e já com sinal (o
     * sinal é que diz se é receita ou despesa, não precisa perguntar).
     */
    private parseCsvBanco(
        conteudo: string,
    ): { data: string; tituloOriginal: string; valor: number; tipo: "receita" | "despesa" }[] {
        const linhas = conteudo
            .split(/\r\n|\n/)
            .map((l) => l.trim())
            .filter((l) => l.length > 0);

        if (linhas.length < 2) {
            return [];
        }

        const cabecalho = this.parseLinhaCsv(linhas[0]).map((c) =>
            c.trim().toLowerCase(),
        );

        const idxData = cabecalho.indexOf("data");
        const idxValor = cabecalho.indexOf("valor");
        const idxDescricao = cabecalho.indexOf("descrição");

        if (idxData === -1 || idxValor === -1 || idxDescricao === -1) {
            throw new Error(
                "Colunas esperadas não encontradas (Data, Valor, Descrição).",
            );
        }

        const resultado: { data: string; tituloOriginal: string; valor: number; tipo: "receita" | "despesa" }[] = [];

        for (let i = 1; i < linhas.length; i++) {
            const campos = this.parseLinhaCsv(linhas[i]);

            const data = this.parseDataBanco(campos[idxData] || "");
            const tituloOriginal = (campos[idxDescricao] || "").trim();
            const valorBruto = Number((campos[idxValor] || "").trim());

            if (!data || !tituloOriginal || !Number.isFinite(valorBruto) || valorBruto === 0) {
                continue;
            }

            resultado.push({
                data,
                tituloOriginal,
                valor: Math.abs(valorBruto),
                tipo: valorBruto > 0 ? "receita" : "despesa",
            });
        }

        return resultado.sort((a, b) => a.data.localeCompare(b.data));
    }

    // =====================================================================
    // AGRUPAMENTO POR DIA (mesma cara da tela de Lançamentos)
    // =====================================================================

    private organizarPorDia(): void {
        const grupos = new Map<string, LinhaImportada[]>();

        for (const linha of this.linhas) {
            if (!grupos.has(linha.data)) {
                grupos.set(linha.data, []);
            }

            grupos.get(linha.data)!.push(linha);
        }

        this.grupos = Array.from(grupos.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([data, itens]) => ({
                data,
                dia: Number(data.split("-")[2]),
                itens,
            }));
    }

    // =====================================================================
    // CATEGORIAS
    // =====================================================================

    get categoriasPrincipais(): Categoria[] {
        return this.categorias.filter((categoria) => !categoria.categoria_pai_id);
    }

    subcategoriasDa(categoriaId: string): Categoria[] {
        return this.categorias.filter(
            (categoria) => categoria.categoria_pai_id === categoriaId,
        );
    }

    private categoria(linha: LinhaImportada): Categoria | null {
        if (!linha.categoriaId) {
            return null;
        }

        return this.categorias.find((c) => c.id === linha.categoriaId) ?? null;
    }

    corCategoria(linha: LinhaImportada): string {
        return this.categoria(linha)?.cor || "#9aa0a6";
    }

    iconeCategoria(linha: LinhaImportada): string {
        return this.categoria(linha)?.icone || "receipt_long";
    }

    // =====================================================================
    // CONFIGURAR LINHA (descrição / categoria / origem)
    // =====================================================================

    linhaConfigurada(linha: LinhaImportada): boolean {
        if (linha.jaImportada) {
            return true;
        }

        if (!linha.categoriaId || !linha.origem) {
            return false;
        }

        if (linha.parcelaTotalDetectada && linha.modoParcelamento === "parcelas") {
            return (
                !!linha.quantidadeParcelas &&
                linha.quantidadeParcelas >= 2 &&
                !!linha.parcelaAtual &&
                linha.parcelaAtual >= 1 &&
                linha.parcelaAtual <= linha.quantidadeParcelas &&
                !!linha.valorTotalParcelamento &&
                linha.valorTotalParcelamento > 0
            );
        }

        return true;
    }

    pendentesCount(): number {
        return this.linhas.filter((l) => !this.linhaConfigurada(l)).length;
    }

    abrirEdicaoLinha(linha: LinhaImportada): void {
        if (linha.jaImportada) {
            return;
        }

        this.linhaEmEdicao = linha;

        this.formEdicao = {
            descricao: linha.descricao,
            categoriaId: linha.categoriaId || "",
            origem: linha.origem,
            modoParcelamento: linha.modoParcelamento || "unitario",
            quantidadeParcelas:
                linha.quantidadeParcelas || linha.parcelaTotalDetectada || 2,
            parcelaAtual: linha.parcelaAtual || linha.parcelaAtualDetectada || 1,
            valorTotalParcelamento: linha.valorTotalParcelamento || linha.valor,
        };
    }

    fecharEdicaoLinha(): void {
        this.linhaEmEdicao = null;
    }

    async salvarEdicaoLinha(): Promise<void> {
        if (!this.linhaEmEdicao) {
            return;
        }

        const ehParcelavel = !!this.linhaEmEdicao.parcelaTotalDetectada;
        const modoParcelamento = ehParcelavel ? this.formEdicao.modoParcelamento : null;

        if (modoParcelamento === "parcelas") {
            if (
                !Number.isInteger(this.formEdicao.quantidadeParcelas) ||
                this.formEdicao.quantidadeParcelas < 2
            ) {
                alert("Informe uma quantidade de parcelas válida (mínimo 2).");
                return;
            }

            if (
                !Number.isInteger(this.formEdicao.parcelaAtual) ||
                this.formEdicao.parcelaAtual < 1 ||
                this.formEdicao.parcelaAtual > this.formEdicao.quantidadeParcelas
            ) {
                alert("A parcela atual precisa estar entre 1 e a quantidade de parcelas.");
                return;
            }

            if (
                !Number.isFinite(this.formEdicao.valorTotalParcelamento) ||
                this.formEdicao.valorTotalParcelamento <= 0
            ) {
                alert("Informe um valor total válido.");
                return;
            }
        }

        const descricao = this.formEdicao.descricao.trim() || this.linhaEmEdicao.chaveRegra;
        const categoriaId = this.formEdicao.categoriaId || null;
        const origem = this.formEdicao.origem || "";

        this.linhaEmEdicao.descricao = descricao;
        this.linhaEmEdicao.categoriaId = categoriaId;
        this.linhaEmEdicao.origem = origem;
        this.linhaEmEdicao.modoParcelamento = modoParcelamento;

        if (modoParcelamento === "parcelas") {
            this.linhaEmEdicao.quantidadeParcelas = this.formEdicao.quantidadeParcelas;
            this.linhaEmEdicao.parcelaAtual = this.formEdicao.parcelaAtual;
            this.linhaEmEdicao.valorTotalParcelamento = this.formEdicao.valorTotalParcelamento;
        }

        // Aplica a mesma descrição/categoria/origem em outras linhas dessa
        // MESMA importação que têm o título igual (ex.: comprou no mesmo
        // restaurante 3 vezes no mês) — assim o usuário configura uma vez
        // só e as ocorrências repetidas já entram prontas, sem precisar
        // abrir uma por uma. Parcelamento não propaga: cada ocorrência tem
        // seu próprio número de parcela.
        const chaveAlvo = this.linhaEmEdicao.chaveRegra;
        const idAlvo = this.linhaEmEdicao.id;

        for (const outra of this.linhas) {
            if (outra.id === idAlvo || outra.jaImportada) {
                continue;
            }

            if (outra.chaveRegra !== chaveAlvo) {
                continue;
            }

            outra.descricao = descricao;
            outra.categoriaId = categoriaId;
            outra.origem = origem;
        }

        const partesOrigem = this.processarOrigem(origem);

        try {
            await this.db.salvarRegraImportacao({
                tituloOriginal: this.linhaEmEdicao.chaveRegra,
                descricao,
                categoriaId,
                contaId: partesOrigem.conta_id,
                cartaoId: partesOrigem.cartao_id,
            });
        } catch (erro) {
            console.error("Erro ao salvar regra de importação:", erro);
        }

        this.fecharEdicaoLinha();
    }

    removerLinha(linha: LinhaImportada): void {
        this.linhas = this.linhas.filter((l) => l.id !== linha.id);

        this.organizarPorDia();
    }

    private processarOrigem(origem: string): {
        conta_id: string | null;
        cartao_id: string | null;
    } {
        if (!origem) {
            return { conta_id: null, cartao_id: null };
        }

        const partes = origem.split(":");

        const tipo = partes[0];
        const id = partes.slice(1).join(":");

        if (!id) {
            return { conta_id: null, cartao_id: null };
        }

        if (tipo === "conta") {
            return { conta_id: id, cartao_id: null };
        }

        if (tipo === "cartao") {
            return { conta_id: null, cartao_id: id };
        }

        return { conta_id: null, cartao_id: null };
    }

    // =====================================================================
    // EXPORTAR
    // =====================================================================

    async exportarLancamentos(): Promise<void> {
        if (this.exportando || !this.linhas.length) {
            return;
        }

        const pendentes = this.pendentesCount();

        if (pendentes > 0) {
            alert(
                `Defina categoria e conta/cartão de todos os lançamentos antes de exportar. Falta${pendentes > 1 ? "m" : ""} ${pendentes}.`,
            );
            return;
        }

        this.exportando = true;
        this.erro = null;

        let criados = 0;
        let ignorados = 0;

        try {
            for (const linha of this.linhas) {
                if (linha.jaImportada) {
                    ignorados++;
                    continue;
                }

                const origem = this.processarOrigem(linha.origem);

                // Extrato de banco já é dinheiro que entrou/saiu de verdade
                // (não é uma cobrança futura como uma compra no cartão), então
                // já nasce confirmado.
                const confirmado = this.tipoExtrato === "banco";

                if (linha.modoParcelamento === "parcelas") {
                    await this.db.criarLancamentoParceladoAncorado({
                        categoria_id: linha.categoriaId,
                        conta_id: origem.conta_id,
                        cartao_id: origem.cartao_id,
                        tipo: linha.tipo,
                        descricao: linha.descricao,
                        data: linha.data,
                        parcela_atual: linha.parcelaAtual!,
                        parcela_total: linha.quantidadeParcelas!,
                        valor_total: linha.valorTotalParcelamento!,
                    });

                    await this.db.marcarSerieParcelasEnviada(
                        linha.chaveRegra,
                        linha.quantidadeParcelas!,
                    );

                    criados++;

                    continue;
                }

                await this.db.criarLancamento({
                    tipo: linha.tipo,
                    descricao: linha.descricao,
                    valor: linha.valor,
                    data: linha.data,
                    categoria_id: linha.categoriaId,
                    conta_id: origem.conta_id,
                    cartao_id: origem.cartao_id,
                    confirmado,
                });

                criados++;
            }

            this.sucesso = `${criados} lançamento(s) importado(s) com sucesso.${ignorados ? ` ${ignorados} já tinham sido importados antes e foram ignorados.` : ""}`;

            this.nomeArquivo = null;
            this.linhas = [];
            this.grupos = [];
        } catch (erro) {
            console.error("Erro ao exportar lançamentos:", erro);

            alert("Não foi possível exportar os lançamentos.");
        } finally {
            this.exportando = false;
        }
    }

    // =====================================================================
    // VALORES / IDS
    // =====================================================================

    get totalImportado(): number {
        return this.linhas.reduce((soma, linha) => soma + linha.valor, 0);
    }

    valorFormatado(valor: number): string {
        return valor.toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    private gerarIdLocal(): string {
        if (typeof crypto !== "undefined" && crypto.randomUUID) {
            return crypto.randomUUID();
        }

        return Date.now().toString(36) + Math.random().toString(36).substring(2);
    }
}
