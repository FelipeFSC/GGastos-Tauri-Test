import { Component } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";

interface SecaoTutorial {
    id: string;
    titulo: string;
    icone: string;
}

/**
 * Página de ajuda estática (sem banco, sem estado) — um guia por todas
 * as telas do sistema, pra dar suporte a quem está usando o app pela
 * primeira vez. Acessível pelo menu ⚙️ no topo.
 */
@Component({
    selector: "app-tutorial",
    standalone: true,
    imports: [CommonModule, RouterLink],
    templateUrl: "./tutorial.component.html",
    styleUrl: "./tutorial.component.css",
})
export class TutorialComponent {
    readonly secoes: SecaoTutorial[] = [
        { id: "comece-por-aqui", titulo: "Comece por aqui", icone: "flag" },
        { id: "visao-geral", titulo: "Visão Geral", icone: "dashboard" },
        { id: "lancamentos", titulo: "Lançamentos", icone: "receipt_long" },
        { id: "repetir", titulo: "Repetir (fixo e parcelado)", icone: "repeat" },
        { id: "dividir", titulo: "Dividir uma despesa", icone: "groups" },
        { id: "contas", titulo: "Contas", icone: "account_balance_wallet" },
        { id: "cartoes", titulo: "Cartões e faturas", icone: "credit_card" },
        { id: "categorias", titulo: "Categorias", icone: "category" },
        { id: "limites", titulo: "Limites de gastos", icone: "speed" },
        { id: "tags", titulo: "Tags", icone: "sell" },
        { id: "relatorios", titulo: "Relatórios", icone: "bar_chart" },
        { id: "importar", titulo: "Importar extrato (CSV)", icone: "upload_file" },
    ];

    irPara(event: Event, id: string): void {
        event.preventDefault();

        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}
