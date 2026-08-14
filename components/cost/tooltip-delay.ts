/**
 * How long a cost tooltip waits before opening.
 *
 * Slower than the app's ordinary tooltips, which is the whole point: those are
 * labels for a control the cursor is aiming at, a cost is a number the cursor
 * is merely crossing on its way to Retry, and a money figure that pops up
 * unbidden is the in-your-face failure this feature exists to avoid. It must
 * therefore stay strictly above Base UI's own default of 600ms — the two cost
 * surfaces used to set 500, which made them the FASTEST tooltips in the app,
 * the exact inverse of what both files said they were doing.
 *
 * It rides on TooltipTrigger, where Base UI actually puts `delay`. The local
 * TooltipProviders this used to need were written around the belief that only
 * a provider could carry it; they bought nothing and cost two extra roots on a
 * component that renders once per passage.
 */
export const COST_TOOLTIP_DELAY_MS = 900
