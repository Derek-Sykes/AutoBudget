import Link from "next/link";

const steps = [
  {
    title: "Add income",
    body: "Enter a paycheck manually or create recurring jobs so AutoBudget can simulate future paychecks.",
  },
  {
    title: "Set your funding plan",
    body: "Choose what percentage of each paycheck should go to your categories, pockets, and Free to Spend.",
  },
  {
    title: "Watch money flow",
    body: "AutoBudget routes income into pockets, sends category leftovers to Overflow, and updates Free to Spend.",
  },
  {
    title: "Review and correct",
    body: "Use Activity to review deposits, transfers, reversals, and paycheck corrections without losing history.",
  },
];

const features = [
  "Main Account, Set Aside, and Free to Spend tracking",
  "Categories, pockets, and Overflow pockets",
  "Funding-plan percentages for paycheck distribution",
  "Recurring jobs with payroll catch-up",
  "Transfers between pockets",
  "Paycheck corrections",
  "Activity history and reversals",
  "Local account login",
];

export default function AboutPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-8 sm:px-6 lg:px-8">
      <section className="card overflow-hidden p-0">
        <div className="bg-gradient-to-br from-brand-50 via-white to-slate-50 p-6 sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-700">
            About AutoBudget
          </p>

          <div className="mt-4 max-w-3xl">
            <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-5xl">
              A budgeting simulator that shows what your money is already committed to.
            </h1>

            <p className="mt-5 text-base leading-7 text-muted sm:text-lg">
              AutoBudget helps you plan how paychecks flow into categories, pockets,
              and Free to Spend before you actually spend the money. It is built around
              one simple idea: your bank balance is not the same thing as money you can
              safely spend.
            </p>
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/signup" className="button-primary text-center">
              Create account
            </Link>
            <Link href="/login" className="button-secondary text-center">
              Log in
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="card p-6 sm:p-8">
          <h2 className="text-2xl font-bold text-slate-950">The core idea</h2>
          <p className="mt-3 text-muted">
            AutoBudget separates your total balance from the money you have already
            mentally reserved.
          </p>

          <div className="mt-6 grid gap-3 rounded-[2rem] bg-slate-50 p-4 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
            <FormulaBlock label="Main Account" value="Total app balance" />
            <FormulaSymbol>-</FormulaSymbol>
            <FormulaBlock label="Set Aside" value="Reserved in pockets" />
            <FormulaSymbol>=</FormulaSymbol>
            <FormulaBlock label="Free to Spend" value="Actually available" strong />
          </div>

          <p className="mt-5 text-sm leading-6 text-muted">
            Free to Spend is derived from the equation above. If money is sitting in a
            pocket for rent, travel, investing, or any other goal, AutoBudget treats it
            as already committed.
          </p>
        </div>

        <div className="card p-6 sm:p-8">
          <h2 className="text-2xl font-bold text-slate-950">Simulation-only</h2>
          <p className="mt-3 text-muted">
            AutoBudget does not connect to real bank accounts, initiate transfers, or
            move real money.
          </p>
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            Balances inside AutoBudget are planning numbers. Use them to understand
            your spending commitments, but do not treat them as live bank data.
          </div>
        </div>
      </section>

      <section className="card p-6 sm:p-8">
        <div className="max-w-3xl">
          <h2 className="text-2xl font-bold text-slate-950">How to use AutoBudget</h2>
          <p className="mt-3 text-muted">
            The app works like a map for your paycheck. Income enters the Main Account,
            then AutoBudget routes it based on your rules.
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {steps.map((step, index) => (
            <div key={step.title} className="rounded-[1.5rem] border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                  {index + 1}
                </span>
                <h3 className="font-semibold text-slate-950">{step.title}</h3>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card p-6 sm:p-8">
          <h2 className="text-2xl font-bold text-slate-950">Key concepts</h2>

          <div className="mt-5 space-y-4">
            <Concept
              title="Categories"
              body="Broad groups like Needs, Travel, Investing, or Monthly Spending."
            />
            <Concept
              title="Pockets"
              body="Specific goals inside categories, such as Rent, Groceries, Spain Trip, or Roth IRA."
            />
            <Concept
              title="Overflow pockets"
              body="Catch-all pockets that hold leftover category money when normal pockets are full or under-allocated."
            />
            <Concept
              title="Funding plan"
              body="The percentage plan that decides how new paychecks should be distributed."
            />
          </div>
        </div>

        <div className="card p-6 sm:p-8">
          <h2 className="text-2xl font-bold text-slate-950">Features included</h2>

          <ul className="mt-5 grid gap-3">
            {features.map((feature) => (
              <li key={feature} className="flex gap-3 text-sm leading-6 text-muted">
                <span className="mt-1 size-2 shrink-0 rounded-full bg-brand-600" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card bg-slate-950 p-6 text-white sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold">Ready to try it?</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Start with the demo account or create your own account, then review the
              dashboard and funding plan.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/login"
              className="rounded-full bg-white px-4 py-2 text-center text-sm font-semibold text-slate-950 shadow-sm transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              >
                Log in
            </Link>

            <Link
                href="/signup"
                className="rounded-full bg-brand-600 px-4 py-2 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
                Sign up
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function FormulaBlock({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={
        strong
          ? "rounded-2xl bg-brand-600 p-4 text-white"
          : "rounded-2xl bg-white p-4 text-slate-950 shadow-sm"
      }
    >
      <p className={strong ? "text-sm text-brand-100" : "text-sm text-muted"}>{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}

function FormulaSymbol({ children }: { children: string }) {
  return (
    <div className="hidden text-2xl font-bold text-slate-500 sm:block" aria-hidden="true">
      {children}
    </div>
  );
}

function Concept({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="font-semibold text-slate-950">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-muted">{body}</p>
    </div>
  );
}