import { Routes } from "@angular/router";

export const routes: Routes = [
  {
    path: "",
    redirectTo: "visao-geral",
    pathMatch: "full",
  },

  {
    path: "visao-geral",
    loadComponent: () =>
      import("./pages/visao-geral/visao-geral.component")
        .then((m) => m.VisaoGeralComponent),
  },

  {
    path: "lancamentos",
    loadComponent: () =>
      import("./pages/lancamentos/lancamentos.component")
        .then((m) => m.LancamentosComponent),
  },

  {
    path: "relatorios",
    loadComponent: () =>
      import("./pages/relatorios/relatorios.component")
        .then((m) => m.RelatoriosComponent),
  },

  {
    path: "contas",
    loadComponent: () =>
      import("./pages/contas/contas.component")
        .then((m) => m.ContasComponent),
  },

  {
    path: "cartoes",
    loadComponent: () =>
      import("./pages/cartoes/cartoes.component")
        .then((m) => m.CartoesComponent),
  },

  {
    path: "categorias",
    loadComponent: () =>
      import("./pages/categorias/categorias.component")
        .then((m) => m.CategoriasComponent),
  },

  {
    path: "limites",
    loadComponent: () =>
      import("./pages/limites/limites.component")
        .then((m) => m.LimitesComponent),
  },

  {
    path: "tags",
    loadComponent: () =>
      import("./pages/tags/tags.component")
        .then((m) => m.TagsComponent),
  },
];