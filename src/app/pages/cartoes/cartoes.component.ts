import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import {
    DatabaseService,
    USUARIO_LOCAL_ID,
} from "../../services/database.service";

interface Conta {
    id: string;
    nome: string;
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
    imports: [CommonModule, FormsModule],
    templateUrl: "./cartoes.component.html",
    styleUrl: "./cartoes.component.css",
})
export class CartoesComponent implements OnInit {
    cartoes: Cartao[] = [];
    contas: Conta[] = [];

    nome = "";
    icone = "";
    cor = "#4285f4";
    limite = 0;
    diaFechamento = 1;
    diaVencimento = 1;
    contaPagamentoId = "";

    icones: string[] = [];
    iconesFiltrados: string[] = [];

    iconeModalAberto = false;
    buscaIcone = "";
    campoIconeAtual: "novo" | "edicao" = "novo";

    iconeEdicao = "";

    editandoId: string | null = null;

    cartaoExpandido: string | null = null;
    faturasPorCartao: Record<string, Fatura[]> = {};

    constructor(private db: DatabaseService) { }

    async ngOnInit() {
        await this.carregar();
    }

    async carregar() {
        this.contas = await this.db.query<Conta>(
            "SELECT id, nome FROM contas ORDER BY nome",
        );

        this.cartoes = await this.db.query<Cartao>(
            "SELECT * FROM cartoes_credito ORDER BY nome",
        );
    }

    nomeConta(id: string | null): string {
        if (!id) return "-";

        return this.contas.find((c) => c.id === id)?.nome ?? "-";
    }

    async toggleFaturas(cartaoId: string) {
        if (this.cartaoExpandido === cartaoId) {
            this.cartaoExpandido = null;
            return;
        }

        this.cartaoExpandido = cartaoId;
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

    async pagar(faturaId: string, cartaoId: string) {
        await this.db.pagarFatura(faturaId);
        await this.carregarFaturas(cartaoId);
    }

    async adicionar(event: Event) {
        event.preventDefault();

        if (!this.nome.trim()) return;

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

        if (!this.editandoId || !this.nome.trim()) return;

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

    limparFormulario() {
        this.nome = "";
        this.icone = "";
        this.cor = "#4285f4";
        this.limite = 0;
        this.diaFechamento = 1;
        this.diaVencimento = 1;
        this.contaPagamentoId = "";
    }

    fecharSeletorIcone() {
        this.iconeModalAberto = false;
        this.buscaIcone = "";
    }

    filtrarIcones() {
        const busca = this.buscaIcone.trim().toLowerCase();

        if (!busca) {
            this.iconesFiltrados = [...this.icones];
            return;
        }

        this.iconesFiltrados = this.icones.filter((icone) =>
            icone.toLowerCase().includes(busca),
        );
    }

    selecionarIcone(icone: string) {
        if (this.campoIconeAtual === "novo") {
            this.icone = icone;
        } else {
            this.iconeEdicao = icone;
        }

        this.fecharSeletorIcone();
    }

    /**
     * Mostra no máximo 300 ícones de uma vez.
     * A busca continua funcionando normalmente.
     */
    iconesVisiveis(): string[] {
        return this.iconesFiltrados.slice(0, 300);
    }

    async remover(id: string) {
        await this.db.run("DELETE FROM cartoes_credito WHERE id = ?", [id]);

        await this.carregar();
    }
}
