import Link from "next/link";
import { ArrowRightIcon, BotIcon, LockIcon, RocketIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const benefits = [
  {
    title: "Isolated execution",
    description: "Run untrusted code and agent workloads in controlled sandboxes without exposing core systems.",
    icon: LockIcon,
  },
  {
    title: "Fast to start",
    description: "Provision sandboxes quickly for trials, internal tools, and developer-facing products.",
    icon: RocketIcon,
  },
  {
    title: "Agent support",
    description: "Give AI agents isolated runtimes for tool use, scripts, and repeatable workflow execution.",
    icon: BotIcon,
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,oklch(0.45_0.11_280_/_0.30),transparent_32%),linear-gradient(180deg,oklch(0.24_0.03_276),oklch(0.18_0.02_270))] text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between rounded-full border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-white text-black shadow-lg shadow-white/10">
              <span className="text-sm font-semibold">KX</span>
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/90">Kernlix</p>
              <p className="text-xs text-white/55">Secure sandbox runtime</p>
            </div>
          </div>

          <nav className="hidden items-center gap-6 text-sm text-white/70 md:flex">
            <a href="#product" className="transition hover:text-white">
              Product
            </a>
            <a href="#how-it-works" className="transition hover:text-white">
              How it works
            </a>
            <a href="#enterprise" className="transition hover:text-white">
              Enterprise
            </a>
            <Link href="/login" className="transition hover:text-white">
              Log in
            </Link>
          </nav>
        </header>

        <section className="flex flex-1 items-center py-16 sm:py-20 lg:py-24">
          <div className="grid w-full gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:items-center">
            <div className="max-w-3xl">
              <Badge
                variant="outline"
                className="h-auto rounded-full border-white/10 bg-white/6 px-3 py-1 uppercase tracking-[0.18em] text-white/65 backdrop-blur"
              >
                Secure execution for product and platform teams
              </Badge>
              <h1 className="mt-6 max-w-2xl text-5xl font-semibold tracking-tight text-white sm:text-6xl">
                Let users try the product. Keep their code contained.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-white/72">
                Kernlix gives teams isolated environments for running code, agents, and automation.
                Start with a trial, then scale into an enterprise deployment when the workload grows.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  className="h-12 rounded-full bg-white px-6 text-sm font-semibold text-black hover:bg-white/90"
                >
                  <Link href="/signup">
                    Start free trial
                    <ArrowRightIcon className="ml-1" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="h-12 rounded-full border-white/15 bg-white/5 px-6 text-sm font-semibold text-white hover:bg-white/10 hover:text-white"
                >
                  <a href="mailto:sales@kernlix.com?subject=Enterprise%20license%20inquiry">
                    Get enterprise license
                  </a>
                </Button>
              </div>

              <p className="mt-5 text-sm text-white/55">
                Built for internal platforms, developer tools, and AI products that need safer code execution.
              </p>
            </div>

            <Card className="rounded-[2rem] border-white/10 bg-white/6 py-0 shadow-2xl shadow-black/30 backdrop-blur">
              <CardContent className="p-6">
                <Card className="rounded-[1.5rem] border-white/8 bg-black/20 py-0">
                  <CardHeader className="flex flex-row items-start justify-between gap-4 px-5 pt-5">
                    <div>
                      <CardTitle className="text-sm font-medium text-white">Trial workspace</CardTitle>
                      <CardDescription className="text-xs text-white/50">Provisioned in seconds</CardDescription>
                    </div>
                    <Badge className="rounded-full border border-emerald-400/20 bg-emerald-400/12 text-emerald-200">
                      Healthy
                    </Badge>
                  </CardHeader>
                  <Separator className="bg-white/8" />

                  <CardContent className="space-y-3 px-5 pb-5">
                    <Card className="rounded-2xl border-white/8 bg-white/[0.03] py-0">
                      <CardContent className="p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-white/45">Sandbox</p>
                        <p className="mt-2 text-sm text-white/80">
                          Dedicated runtime for trial users and automation flows.
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="rounded-2xl border-white/8 bg-white/[0.03] py-0">
                      <CardContent className="p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-white/45">Observability</p>
                        <p className="mt-2 text-sm text-white/80">
                          Track usage, status, and lifecycle from one dashboard.
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="rounded-2xl border-white/8 bg-white/[0.03] py-0">
                      <CardContent className="p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-white/45">Enterprise path</p>
                        <p className="mt-2 text-sm text-white/80">
                          Move from self-serve trial to licensed deployment without changing the model.
                        </p>
                      </CardContent>
                    </Card>
                  </CardContent>
                  <CardFooter className="justify-between border-white/8 bg-white/[0.03] text-xs text-white/55">
                    <span>Trial first</span>
                    <span>Scale later</span>
                  </CardFooter>
                </Card>
              </CardContent>
            </Card>
          </div>
        </section>

        <Separator className="bg-white/8" />

        <section id="product" className="grid gap-4 pb-8 pt-8 sm:grid-cols-3">
          {benefits.map((benefit) => (
            <Card key={benefit.title} className="rounded-[1.75rem] border-white/10 bg-white/5 py-0 backdrop-blur">
              <CardContent className="p-6">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-white text-black">
                  <benefit.icon className="size-5" />
                </div>
                <CardTitle className="mt-5 text-lg font-semibold text-white">{benefit.title}</CardTitle>
                <CardDescription className="mt-2 text-sm leading-6 text-white/65">
                  {benefit.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </section>

        <Separator className="bg-white/8" />

        <section id="how-it-works" className="grid gap-4 py-8 lg:grid-cols-3">
          {[
            ["1. Create workspace", "Open an account and launch a sandbox for your trial environment."],
            ["2. Run product workloads", "Execute user code, agents, or internal jobs in isolated runtime boundaries."],
            ["3. Upgrade when needed", "Contact sales for enterprise licensing, private deployments, or larger capacity."],
          ].map(([title, description]) => (
            <Card key={title} className="rounded-[1.75rem] border-white/10 bg-black/15 py-0">
              <CardContent className="p-6">
                <CardTitle className="text-sm font-semibold text-white">{title}</CardTitle>
                <CardDescription className="mt-3 text-sm leading-6 text-white/65">
                  {description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </section>

        <Card id="enterprise" className="mb-6 mt-8 rounded-[2rem] border-white/10 bg-white/6 py-0 backdrop-blur">
          <CardContent className="flex flex-col gap-6 p-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <Badge
                variant="outline"
                className="h-auto rounded-full border-white/10 bg-transparent px-3 py-1 uppercase tracking-[0.18em] text-white/50"
              >
                Enterprise
              </Badge>
              <h2 className="mt-3 text-3xl font-semibold text-white">
                Need private deployment or a broader license?
              </h2>
              <p className="mt-3 text-sm leading-7 text-white/68">
                For larger teams, regulated environments, or commercial product usage, we can support an
                enterprise license and tailored rollout.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                variant="outline"
                size="lg"
                className="h-12 rounded-full border-white/15 bg-transparent px-6 text-white hover:bg-white/10 hover:text-white"
              >
                <Link href="/login">Log in</Link>
              </Button>
              <Button
                asChild
                size="lg"
                className="h-12 rounded-full bg-white px-6 text-black hover:bg-white/90"
              >
                <a href="mailto:sales@kernlix.com?subject=Enterprise%20license%20inquiry">
                  Contact sales
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
