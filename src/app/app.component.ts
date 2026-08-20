import { Component } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterOutlet, RouterLink, RouterLinkActive } from "@angular/router";
import { appDataDir, join } from "@tauri-apps/api/path";
import { DatabaseService } from "./services/database.service";

/** Atualizar aqui a cada release — mostrado no pop-up "Informações". */
const VERSAO_APP = "1.4.3";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent {
  menuAberto = false;

  informacoesAberto = false;
  readonly versaoApp = VERSAO_APP;
  caminhoBanco = "";
  carregandoCaminho = false;

  constructor(private database: DatabaseService) {
    this.database.init();
  }

  async abrirInformacoes(): Promise<void> {
    this.menuAberto = false;
    this.informacoesAberto = true;

    if (this.caminhoBanco || this.carregandoCaminho) {
      return;
    }

    this.carregandoCaminho = true;

    try {
      const pasta = await appDataDir();
      this.caminhoBanco = await join(pasta, "ggastos.db");
    } catch (erro) {
      console.error("Erro ao obter o caminho do banco:", erro);
      this.caminhoBanco = "Não foi possível determinar o caminho.";
    } finally {
      this.carregandoCaminho = false;
    }
  }

  fecharInformacoes(): void {
    this.informacoesAberto = false;
  }
}
