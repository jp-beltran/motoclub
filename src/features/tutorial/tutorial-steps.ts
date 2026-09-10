export interface TutorialStep {
  readonly id: string
  /** Short headline; it is the balloon's accessible name. */
  readonly title: string
  readonly body: string
  /**
   * The route this step talks about. Advancing to a step on another route
   * navigates there, so the operator never has to guess where to look.
   * Absent on the closing step, which is true on every screen.
   */
  readonly route?: string
  /**
   * The `data-tutorial` attribute of the element the balloon points at.
   * Optional, and the balloon centres itself when the element is not on
   * screen — a step that finds nothing still gets read.
   */
  readonly target?: string
}

/**
 * The tour, in the order the night actually happens: look at the panel,
 * launch consumption all evening, close the visitors' tabs, and only then
 * the monthly side of it (who pays what, prices, stock, payments, closing).
 *
 * Text only. The tutorial explains the screens and moves between them; it
 * never computes a total, decides anything about money, or reads the domain
 * beyond what the screen behind it is already showing.
 */
export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'painel',
    title: 'Comece a noite por aqui',
    body:
      'O painel mostra o evento ativo, quanto já saiu de bar no mês e quem ainda está ' +
      'devendo. É a olhada rápida antes de abrir o balcão.',
    route: '/',
    target: 'painel',
  },
  {
    id: 'lancamentos',
    title: 'Lançamentos: o coração disso',
    body:
      'Escolha a pessoa e toque no item: são dois toques para o primeiro consumo e um ' +
      'toque por bebida depois disso. Sem formulário e sem confirmação, porque é o que ' +
      'faz a coisa funcionar no balcão cheio.',
    route: '/lancamentos',
    target: 'lancamentos',
  },
  {
    id: 'comandas',
    title: 'A comanda do visitante',
    body:
      'Abra a comanda quando o visitante chegar, vá lançando durante a noite e feche no ' +
      'fim. A comanda fechada continua aqui com o resumo, para você conferir depois.',
    route: '/comandas',
    target: 'comandas',
  },
  {
    id: 'consumidores',
    title: 'Integrante ou visitante',
    body:
      'É a diferença que mais confunde. O integrante vai acumulando e paga no fechamento ' +
      'do mês; o visitante fecha na comanda dele, na hora.',
    route: '/consumidores',
    target: 'consumidores',
  },
  {
    id: 'itens',
    title: 'Itens: preço e custo',
    body:
      'Aqui ficam o preço de venda e o custo de cada item. É dessa diferença que sai a ' +
      'margem que aparece no painel, então vale manter os dois atualizados.',
    route: '/itens',
    target: 'itens',
  },
  {
    id: 'estoque',
    title: 'Estoque: entrada e baixa',
    body:
      'Registre a entrada sempre que comprar bebida. A baixa é automática: cada consumo ' +
      'lançado já desconta do estoque, você não precisa dar baixa na mão.',
    route: '/estoque',
    target: 'estoque',
  },
  {
    id: 'pagamentos',
    title: 'Registre o que já foi pago',
    body:
      'Anote aqui o que cada um pagou. Se o integrante pagou só uma parte, registre o ' +
      'valor que ele deu — o resto continua em aberto no nome dele.',
    route: '/pagamentos',
    target: 'pagamentos',
  },
  {
    id: 'fechamento',
    title: 'Fechamento do mês',
    body:
      'Fechar o mês congela quanto cada integrante deve. É o passo que transforma o ' +
      'movimento do mês na lista do que você tem para receber.',
    route: '/fechamento',
    target: 'fechamento',
  },
  {
    id: 'fim',
    title: 'Pronto, é isso',
    body:
      'Quando quiser rever, toque em Tutorial aqui em cima — quantas vezes precisar. Os ' +
      'dados do bar ficam salvos neste computador.',
    target: 'botao-tutorial',
  },
]
