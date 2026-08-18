import { Component, OnInit, ViewChild } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import {
    DatabaseService,
    USUARIO_LOCAL_ID,
} from "../../services/database.service";
import { IconPickerButtonComponent } from "../../shared/icon-picker/icon-picker-button.component";
import { ConfirmarExclusaoComponent } from "../../shared/confirmar-exclusao/confirmar-exclusao.component";

interface Conta {
    id: string;
    nome: string;
    ativo: number;
}

interface Cartao {
    id: string;
    nome: string;
    icone: string | null;
    cor: string | null;
    limite: number;
    dia_fechamento: number;
    dia_vencimento: number;
    conta_pagamento_id: string | null;
    ativo: number;
}

interface Fatura {
    id: string;
    cartao_id: string;
    mes_referencia: number;
    ano_referencia: number;
    data_fechamento: string;
    data_vencimento: string;
    status: string;
    total: number;
}

@Component({
    selector: "app-cartoes",
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, IconPickerButtonComponent, ConfirmarExclusaoComponent],
    templateUrl: "./cartoes.component.html",
    styleUrl: "./cartoes.component.css",
})
export class CartoesComponent implements OnInit {
    @ViewChild("confirmarExclusao") confirmarExclusao!: ConfirmarExclusaoComponent;

    cartoes: Cartao[] = [];
    contas: Conta[] = [];

    private idParaExcluir: string | null = null;

    nome = "";
    icone = "";
    cor = "#4285f4";
    limite = 0;
    diaFechamento = 1;
    diaVencimento = 1;
    contaPagamentoId = "";

    editandoId: string | null = null;

    cartaoExpandido: string | null = null;
    faturasPorCartao: Record<string, Fatura[]> = {};

    constructor(private db: DatabaseService) { }

    async ngOnInit() {
        await this.carregar();
    }

    async carregar() {
        this.contas = await this.db.query<Conta>(
            "SELECT id, nome, ativo FROM contas ORDER BY nome",
        );

        this.cartoes = await this.db.query<Cartao>(
            "SELECT * FROM cartoes_credito ORDER BY nome",
        );
    }

    nomeConta(id: string | null): string {
        if (!id) return "-";

        return this.contas.find((c) => c.id === id)?.nome ?? "-";
    }

    /** Contas oferecidas no seletor de "conta de pagamento": ativas, ou a que já está configurada. */
    get contasSelecionaveis(): Conta[] {
        return this.contas.filter(
            (conta) => conta.ativo || conta.id === this.contaPagamentoId,
        );
    }

    async toggleFaturas(cartaoId: string) {
        if (this.cartaoExpandido === cartaoId) {
            this.cartaoExpandido = null;
            return;
        }

        this.cartaoExpandido = cartaoId;

        /*
         * Antes de mostrar a lista, verifica se alguma fatura ficou "presa"
         * em aberto sem nenhum lançamento nem saldo pendente (ex.: usuário
         * apagou todos os lançamentos daquele mês) e corrige o status.
         */
        await this.db.verificarFaturasDoCartao(cartaoId);

        await this.carregarFaturas(cartaoId);
    }

    async carregarFaturas(cartaoId: string) {
        this.faturasPorCartao[cartaoId] = await this.db.query<Fatura>(
            `SELECT f.*, COALESCE(
        (SELECT SUM(l.valor)
         FROM lancamentos l
         WHERE l.fatura_id = f.id), 0
       ) as total
       FROM faturas f
       WHERE f.cartao_id = ?
       ORDER BY f.ano_referencia DESC, f.mes_referencia DESC`,
            [cartaoId],
        );
    }

    async adicionar(event: Event) {
        event.preventDefault();

        const erro = this.validar();

        if (erro) {
            alert(erro);
            return;
        }

        await this.db.run(
            `INSERT INTO cartoes_credito
        (id, usuario_id, nome, icone, cor, limite, dia_fechamento, dia_vencimento, conta_pagamento_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                this.db.gerarId(),
                USUARIO_LOCAL_ID,
                this.nome.trim(),
                this.icone || null,
                this.cor || null,
                this.limite,
                this.diaFechamento,
                this.diaVencimento,
                this.contaPagamentoId || null,
            ],
        );

        this.limparFormulario();
        await this.carregar();
    }

    iniciarEdicao(cartao: Cartao) {
        this.editandoId = cartao.id;

        this.nome = cartao.nome;
        this.icone = cartao.icone || "";
        this.cor = cartao.cor || "#4285f4";
        this.limite = cartao.limite;
        this.diaFechamento = cartao.dia_fechamento;
        this.diaVencimento = cartao.dia_vencimento;
        this.contaPagamentoId = cartao.conta_pagamento_id || "";

        window.scrollTo({
            top: 0,
            behavior: "smooth",
        });
    }

    async salvarEdicao(event: Event) {
        event.preventDefault();

        if (!this.editandoId) return;

        const erro = this.validar();

        if (erro) {
            alert(erro);
            return;
        }

        await this.db.run(
            `UPDATE cartoes_credito
       SET nome = ?,
           icone = ?,
           cor = ?,
           limite = ?,
           dia_fechamento = ?,
           dia_vencimento = ?,
           conta_pagamento_id = ?
       WHERE id = ?`,
            [
                this.nome.trim(),
                this.icone || null,
                this.cor || null,
                this.limite,
                this.diaFechamento,
                this.diaVencimento,
                this.contaPagamentoId || null,
                this.editandoId,
            ],
        );

        this.cancelarEdicao();
        await this.carregar();
    }

    cancelarEdicao() {
        this.editandoId = null;
        this.limparFormulario();
    }

    /** Nome, ícone, cor, limite, fechamento, vencimento e conta de pagamento são obrigatórios. */
    private validar(): string | null {
        if (!this.nome.trim()) {
            return "Informe o nome do cartão.";
        }

        if (!this.icone) {
            return "Selecione um ícone para o cartão.";
        }

        if (!this.cor) {
            return "Selecione uma cor para o cartão.";
        }

        if (!(this.limite > 0)) {
            return "Informe o limite do cartão.";
        }

        if (!this.diaFechamento || this.diaFechamento < 1 || this.diaFechamento > 31) {
            return "Informe o dia de fechamento (entre 1 e 31).";
        }

        if (!this.diaVencimento || this.diaVencimento < 1 || this.diaVencimento > 31) {
            return "Informe o dia de vencimento (entre 1 e 31).";
        }

        if (!this.contaPagamentoId) {
            return "Selecione a conta para pagamento do cartão.";
        }

        return null;
    }

    limparFormulario() {
        this.nome = "";
        this.icone = "";
        this.cor = "#4285f4";
        this.limite = 0;
        this.diaFechamento = 1;
        this.diaVencimento = 1;
        this.contaPagamentoId = "";
    }

    abrirConfirmacaoExclusao(cartao: Cartao) {
        this.idParaExcluir = cartao.id;
        this.confirmarExclusao.abrir(cartao.nome, "cartão");
    }

    async confirmarManterHistorico() {
        if (!this.idParaExcluir) return;

        await this.db.run("UPDATE cartoes_credito SET ativo = 0 WHERE id = ?", [
            this.idParaExcluir,
        ]);

        this.idParaExcluir = null;
        await this.carregar();
    }

    async confirmarApagarTudo() {
        if (!this.idParaExcluir) return;

        await this.db.excluirCartaoComHistorico(this.idParaExcluir);

        this.idParaExcluir = null;
        await this.carregar();
    }

    async reativar(id: string) {
        await this.db.run("UPDATE cartoes_credito SET ativo = 1 WHERE id = ?", [id]);
        await this.carregar();
    }
}
