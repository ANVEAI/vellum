import Link from "next/link";
import { db, ensureWal } from "@/lib/db";
import { TopNav } from "@/components/ui/chrome";
import { Icon } from "@/components/ui/icon";
import { Library, type LibraryCard } from "./library";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await ensureWal();
  const documents = await db.document.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      kind: true,
      title: true,
      status: true,
      themeName: true,
      slides: true,
      updatedAt: true,
    },
  });

  const cards: LibraryCard[] = documents.map((doc) => {
    let firstSlide: PlateSlide | null = null;
    let slideCount = 0;
    try {
      const slides = JSON.parse(doc.slides) as PlateSlide[];
      slideCount = slides.length;
      firstSlide = slides[0] ?? null;
    } catch {
      firstSlide = null;
    }
    return {
      id: doc.id,
      kind: doc.kind,
      title: doc.title,
      status: doc.status,
      themeName: doc.themeName,
      updatedAt: doc.updatedAt.toISOString(),
      firstSlide,
      slideCount,
    };
  });

  return (
    <main className="min-h-screen">
      <TopNav
        right={
          <Link href="/new" className="btn btn-primary">
            <Icon name="plus" size={16} />
            Create
          </Link>
        }
      />
      <section className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="t-title2 font-semibold">Library</h1>
        <p className="t-body mt-1 text-ink-2">
          Presentations and documents, generated and edited on this machine.
        </p>
        <Library cards={cards} />
      </section>
    </main>
  );
}
