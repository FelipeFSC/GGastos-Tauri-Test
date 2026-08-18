import { Component, OnInit, ViewChild } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import {
	DatabaseService,
	USUARIO_LOCAL_ID,
} from "../../services/database.service";
import { IconPickerButtonComponent } from "../../shared/icon-picker/icon-picker-button.component";
import { ConfirmarExclusaoComponent } from "../../shared/confirmar-exclusao/confirmar-exclusao.component";

interface Conta {
	id: string;
	nome: string;
	icone: string | null;
	cor: string | null;
	saldo_inicial: number;
	nao_somar_saldo: number;
	ativo: number;
}

@Component({
	selector: "app-contas",
	standalone: true,
	imports: [CommonModule, FormsModule, IconPickerButtonComponent, ConfirmarExclusaoComponent],
	templateUrl: "./contas.component.html",
	styleUrl: "./contas.component.css",
})
export class ContasComponent implements OnInit {
	@ViewChild("confirmarExclusao") confirmarExclusao!: ConfirmarExclusaoComponent;

	contas: Conta[] = [];

	private idParaExcluir: string | null = null;

	nome = "";
	icone = "";
	cor = "#4285f4";
	saldoInicial = 0;
	naoSomar = false;

	editandoId: string | null = null;

	constructor(private db: DatabaseService) { }

	async ngOnInit() {
		await this.carregar();
	}

	async carregar() {
		this.contas = await this.db.query<Conta>(
			"SELECT * FROM contas ORDER BY nome",
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
			`INSERT INTO contas
        (id, usuario_id, nome, icone, cor, saldo_inicial, nao_somar_saldo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				this.db.gerarId(),
				USUARIO_LOCAL_ID,
				this.nome.trim(),
				this.icone || null,
				this.cor || null,
				this.saldoInicial,
				this.naoSomar ? 1 : 0,
			],
		);

		this.limparFormulario();
		await this.carregar();
	}

	iniciarEdicao(conta: Conta) {
		this.editandoId = conta.id;

		this.nome = conta.nome;
		this.icone = conta.icone || "";
		this.cor = conta.cor || "#4285f4";
		this.saldoInicial = conta.saldo_inicial;
		this.naoSomar = !!conta.nao_somar_saldo;

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
			`UPDATE contas
       SET nome = ?,
           icone = ?,
           cor = ?,
           saldo_inicial = ?,
           nao_somar_saldo = ?
       WHERE id = ?`,
			[
				this.nome.trim(),
				this.icone || null,
				this.cor || null,
				this.saldoInicial,
				this.naoSomar ? 1 : 0,
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

	/** Nome, ícone e cor são obrigatórios. */
	private validar(): string | null {
		if (!this.nome.trim()) {
			return "Informe o nome da conta.";
		}

		if (!this.icone) {
			return "Selecione um ícone para a conta.";
		}

		if (!this.cor) {
			return "Selecione uma cor para a conta.";
		}

		return null;
	}

	limparFormulario() {
		this.nome = "";
		this.icone = "";
		this.cor = "#4285f4";
		this.saldoInicial = 0;
		this.naoSomar = false;
	}

	abrirConfirmacaoExclusao(conta: Conta) {
		this.idParaExcluir = conta.id;
		this.confirmarExclusao.abrir(conta.nome, "conta");
	}

	async confirmarManterHistorico() {
		if (!this.idParaExcluir) return;

		await this.db.run("UPDATE contas SET ativo = 0 WHERE id = ?", [
			this.idParaExcluir,
		]);

		this.idParaExcluir = null;
		await this.carregar();
	}

	async confirmarApagarTudo() {
		if (!this.idParaExcluir) return;

		await this.db.excluirContaComHistorico(this.idParaExcluir);

		this.idParaExcluir = null;
		await this.carregar();
	}

	async reativar(id: string) {
		await this.db.run("UPDATE contas SET ativo = 1 WHERE id = ?", [id]);
		await this.carregar();
	}
}
