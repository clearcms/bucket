# Marketing CMS Data Layer — Proposal

**Status:** Draft, 2026-05-09. Written from first principles, then cross-checked against landscape research (see §11). The wedge is real: no surveyed system ships *typed-block JSON files-as-truth + schema-driven multi-persona admin + CRDT-only-on-prose-fields*. That is the shape we are claiming.

**Audience:** anyone shaping `clear` (the CMS) and `@clearcms/bucket` (the storage substrate) toward a credible marketing-CMS product.

---

## 0. The one-paragraph version

`@clearcms/bucket` is the storage substrate — a document database that lives in plain JSON files. It is mostly built. `clear` is the layer above it: a typed-block content runtime tuned for marketing sites, with schemas that drive both validation and the editor UI, references between documents, an asset model, drafts/publish via a status field, and (eventually) scoped real-time collaboration. We are not building a general database. We are building a content-shaped layer on top of one we already own. The competitive landscape (§11) is thinner than it looks — Decap is unmaintained, Contentlayer abandoned, Payload was acquired by Figma in 2025, Keystatic's "static-deploy" pitch turns out to require server compute for its GitHub mode, TinaCMS pays for visual editing with an ~800–900 KB bundle in production. The opening is real.

---

## 1. The system at a glance

Three layers, bottom-up:

| Layer | Lives in | What it does |
|---|---|---|
| **Storage** | `@clearcms/bucket` (this repo) | Files-are-truth document DB. Envelope + collections + adapters + Mongo-flavored query + schema validation. |
| **Content runtime** | `clear` (sibling repo) | Typed blocks · refs · prose fields · asset model · drafts/publish · multi-persona editor surfaces. |
| **Frontend adapters** | `@clearcms/clear-astro`, `@clearcms/clear-next`, … | Thin shims that expose `clear`'s content to a framework's collection/loader API. |

The wedge for the whole stack: **a marketing site's content lives as a folder you own, readable in any text editor, diffable by `git`, survivable without our software.** Everything else has to be compatible with that.

---

## 2. First principles

1. **Files are truth.** Substrate is `bucket`. JSON envelope per document, in a folder. Anything we build must round-trip cleanly to that.
2. **Schemas drive everything.** Types, validation, forms, visual canvas, even the migration story all derive from one declaration.
3. **Typed blocks beat raw MDX bodies.** Block trees are JSON-shaped, editable by both code and UI, and round-trip to a future CRDT cleanly. Raw MDX with arbitrary JSX is a dead end for visual editing.
4. **Relations are first-class.** A page references blocks; blocks reference assets; sites reference themes. The runtime resolves them and surfaces dangling references as build errors.
5. **Drafts via a status field; history via git.** No bespoke version table, no parallel `drafts/` tree. Branches are environments.
6. **Single-user first; collab later, narrowly.** Day-one product is a single editor at a time. When collab arrives, it's *block-granular ops on structure + Yjs only inside prose fields* — never a wholesale CRDT for the page.
7. **Headless first; opinionated UI second.** First customers integrate via a typed query API. The schema-driven editor follows once the data model is validated by real migrations.
8. **Multi-persona by design, not by bolt-on.** Same content graph, different surfaces — code, forms, visual canvas, scoped agency views. The schema is the shared contract.

---

## 3. What `bucket` already gives us

Before designing anything new, the substrate covers more than half the surface:

- **Document protocol** — envelope (`id`, `data`, `createdAt`, `updatedAt`), collection naming, path safety, atomic writes (`docs/protocol.md`).
- **Mongo-flavored query** — `find({ status: "published" })`, operators, sort/skip/limit (`src/collection.ts`).
- **Standard Schema validation** on every write — Zod tested first; any Standard-Schema validator works.
- **Adapters** — `fs` and `memory` today; `BlobAdapter`, R2, and Workers on the roadmap.
- **Roadmap items already aligned with CMS needs** — BlobAdapter (assets), `listPage` (paginated reads), SQLite cache (fast `find`), references (typed cross-collection links), audit log, OCFL-style integrity inventory.

Net: `clear` does **not** need to invent a storage engine, a query language, an adapter abstraction, or a schema validator. It composes them.

---

## 4. The `clear` layer (above bucket)

What `bucket` is the substrate **for**.

### 4.1 Typed-block schema DSL

A `clear` site declares its collections, blocks, and references in code. The DSL compiles to a Zod schema that bucket consumes directly, plus UI hints the editor surfaces use.

```ts
// sketch — final shape pending §9 question 2
const Hero = block("hero", {
  schema: z.object({
    eyebrow: z.string().optional(),
    headline: z.string(),
    media: ref("assets"),
  }),
  ui: { label: "Hero", icon: "image", fieldOrder: ["eyebrow", "headline", "media"] },
});

const Testimonial = block("testimonial", {
  schema: z.object({
    quote: prose(),       // rich-text portable-text-like tree
    author: z.string(),
    company: z.string().optional(),
  }),
  ui: { label: "Testimonial", icon: "quote" },
});

const Page = collection("pages", {
  schema: z.object({
    slug: z.string().regex(/^[a-z0-9-/]+$/),
    title: z.string(),
    status: z.enum(["draft", "published"]),
    blocks: z.array(z.discriminatedUnion("type", [Hero.schema, Testimonial.schema, /* … */])),
  }),
});
```

Per collection, `clear` opens a `bucket.collection(...)` under the hood. The discriminated-union pattern is what makes blocks a first-class shape without bucket itself needing to know about them.

### 4.2 Reference fields (informs `bucket` v0.3)

`ref("assets")` is a typed reference to another collection's document by id. Concrete bindings:

- On **write**: `clear` validates the target exists in the referenced collection.
- On **read**: `clear` resolves refs lazily (option) or eagerly (option), and exposes a `refsTo(id)` / `refsFrom(id)` API for backrefs.
- On **build**: a healthcheck enumerates dangling references and fails the build.

This maps directly to bucket's roadmap §15.5 ("References + dangling resolution"). `clear` proves out the shape before bucket's protocol freezes it.

### 4.3 Prose fields — adopt Portable Text

Long-form rich text inside a block is stored as **[Portable Text](https://github.com/portabletext/portabletext)** — Sanity's open spec. Decision made; not inventing our own.

Why:
- Existing spec, with serializers and renderers across every major frontend framework.
- Designed explicitly to be "agnostic … serialization into pretty much any markup language" and "built for real-time collaborative interfaces" (Portable Text README).
- Shape: `blocks → children spans → marks/markDefs`. Annotations are *data references*, not inline tags — survives transforms (markdown ↔ HTML ↔ AMP) cleanly.
- Round-trips losslessly to a visual editor (TipTap/Lexical/ProseMirror) and, when collab arrives, to Yjs/Loro inside a single span/block.

Where MDX still appears: **rendering output** for blogs/docs that want markdown source for devs. `clear` ships a CLI for `markdown ↔ portable text` round-trip.

Cited critique informs this decision: Knut Melvær argues MDX [mixes presentation with content](https://dev.to/kmelve/on-the-limits-of-mdx-1c8k) — "content is best stored as ingredients from which you can bake the things that you need." Portable Text is exactly that.

### 4.4 Asset model

- An `Asset` document holds metadata only — alt text, dimensions, MIME, content hash, original filename.
- The bytes live elsewhere, addressed by hash:
  - **Local dev**: `bucket`'s future `BlobAdapter` (roadmap §15.1) writes to a sibling `_blobs/<hash>` namespace inside the same bucket directory.
  - **Production**: same `BlobAdapter` interface, R2/S3 implementation, blobs in object storage.
- `clear` exposes asset URLs through a renderer that knows the binding — local file URL in dev, CDN URL in prod.
- Image transforms (resize, format) are out of scope for `clear`; an adjacent `@clearcms/clear-images` package can wrap a transformer.

### 4.5 Drafts and publish

- `status: "draft" | "published"` is a reserved field on every collection that opts in.
- Production reads filter to `status: "published"`; preview reads include drafts.
- Optional `publishedAt` for scheduling.
- **No revision table, no parallel tree.** Git is the history. Branches are environments. A "preview deploy" is a deploy off a branch.
- For teams that need first-class versioning beyond git, bucket's `_revisions/` reservation (protocol §11) opens a future path; not in v1 of clear.

### 4.6 Multi-persona editor surfaces

The same content graph; different surfaces over it. Each is additive; cut points are clean.

| Surface | Persona | What they do | Phase |
|---|---|---|---|
| Code editor (VS Code, etc.) | Devs | Edit JSON files directly; run `clear dev` for HMR. | clear v0.1 |
| Schema-driven form UI | Owners, content editors | Web app: forms generated from each collection's schema. CRUD per collection. | clear v0.2 |
| Visual page canvas | Designers | Drag/drop blocks; inline rich-text editing. Live preview against the configured frontend. | clear v0.3 |
| Scoped agency view | Agencies | Same surfaces, gated by role/permissions; can ship a "client mode" with most knobs hidden. | clear v0.4 |

All four write through the same `Bucket` API. Persona is permission + UI choice.

### 4.7 Frontend adapters

- `@clearcms/clear-astro` — exposes `clear` content to Astro's `getCollection`/Content Layer API. v0.1 priority since first migrations are Astro sites.
- `@clearcms/clear-next` — RSC loaders, route segment integration. v0.2.
- `@clearcms/clear-remix`, `@clearcms/clear-sveltekit` — on demand.
- These are thin shims: read from bucket, return typed objects. The CMS isn't tied to any runtime.

---

## 5. Collaboration: structure as ops, prose as CRDT

This is the wedge confirmed novel by §11 research: no surveyed CMS ships "block-level structural patches + character-level CRDT scoped only to prose fields." Sanity uses patch/OT-style mutations with `ifRevisionID` — close, but their structural model and prose model are unified, not split. We split them deliberately.

**Phase 1 — single-user (clear v0.1–v0.3).**
Optimistic UI, undo/redo per session. No sync. No CRDT.

**Phase 2 — block-granular ops (clear v1.0).**
The page tree is a JSON document. Edits are structured ops: `setField`, `insertBlock`, `removeBlock`, `reorderBlocks`. Ops broadcast over a websocket; conflicts resolve at block granularity (last-writer-wins by default; UI surfaces "two edits — pick one" on simultaneous block writes).

Block-level ops are commutative enough for our domain — two people rarely move the same block in the same second, and when they do, one move wins. The **Sanity Mutator/Listener split** ([sanity ARCHITECTURE.md](https://github.com/sanity-io/sanity/blob/main/ARCHITECTURE.md)) is the precedent we borrow for this layer: optimistic local mutations, server-broadcast confirmations, conditional `ifRevisionID` to detect divergence.

**Phase 3 — scoped CRDT for prose only (clear v1.x).**
Inside prose fields, we want character-level merge. Each Portable Text span becomes a CRDT-backed text type. Two CRDT options:

- **Yjs** (`Y.Text` / `Y.XmlFragment`) — production-ready, large ecosystem, TipTap/ProseMirror integrations exist.
- **Loro** — supports a "movable tree" CRDT primitive that Yjs lacks (relevant if we ever extend CRDT to reorderable blocks). Currently advises against production use ([Loro README](https://github.com/loro-dev/loro)) — track but don't bet on.

Default: Yjs. Reassess if Loro stabilizes by the time Phase 3 ships.

**Hydrate from Portable Text on session open; snapshot back to Portable Text on save.** The block tree itself never enters the CRDT. This is the pattern.

**Sync infrastructure** — managed candidates: Liveblocks, PartyKit, Y-Sweet. Self-hostable: y-websocket. Note the consolidation: Triplit was acquired by Supabase in 2025 — the local-first sync-engine market is in a buy-vs-build moment, not exploding. Pick when collab is actually being shipped, not earlier.

---

## 6. Migration story

First customers will arrive from existing CMSes. The shape of the migrator matters because it's the schema-validation event for the whole DSL.

| From | Approach |
|---|---|
| **Contentful** | JSON export → mapper script → `bucket.collection(...).insert(...)`. Schema → clear schema is mostly mechanical. Prose fields → portable text via a transformer. |
| **Sanity** | Already portable-text-shaped — possibly the cleanest migration path. Schema definitions translate. |
| **Storyblok / Hygraph** | Similar to Contentful. |
| **WordPress** | Gutenberg blocks export to JSON; map to clear blocks. Classic editor → portable text via HTML transformer. |
| **Webflow / Builder / Framer** | Proprietary, opaque block models. Defer; not v0.x. |

Provide a `clear migrate` CLI with adapters per source. Each adapter ships once a real migration runs through it.

---

## 7. Phased plan, anchored to bucket's roadmap

### Phase A — `bucket` toward v0.3 *(substrate)*

Already on bucket's ROADMAP. Order matters for clear's dependencies:

1. **`BlobAdapter`** (bucket v0.2) — clear can store assets.
2. **`listPage`** (bucket v0.2) — clear can paginate large collections.
3. **SQLite cache** (bucket v0.2) — clear queries don't O(n) scan once corpora grow.
4. **References** (bucket v0.3) — promote clear's ref shape into bucket's protocol.
5. **R2/S3 adapter** (bucket v0.2) — production deploys.

Nothing new to invent on the bucket side that isn't already on the roadmap.

### Phase B — `clear` v0.1 *(typed-block headless content layer)*

- Schema DSL: `collection`, `block`, `ref`, `prose`.
- `Clear` runtime that opens a bucket, registers collections, and exposes typed query API on top of bucket's.
- Astro adapter (`@clearcms/clear-astro`).
- CLI: `clear init`, `clear dev`, `clear validate` (dangling refs, schema drift), `clear migrate <from>`.
- **No editor UI.** Devs author content as JSON; first migrating customer ships off this.

### Phase C — `clear` v0.2 *(form-based editor UI)*

- Web app: schema-driven forms. One screen per collection.
- Drafts/publish workflow.
- Asset uploader against `BlobAdapter`.
- Single-user; saves through bucket.

### Phase D — `clear` v0.3 *(visual page composition)*

- Drag/drop block canvas. Inline rich-text editing on prose fields.
- Live preview against the configured frontend (Astro dev server in dev, hosted preview in prod).
- Still single-user.

### Phase E — `clear` v1.0 *(collab)*

- Block-granular ops over websocket (Phase 2 above).
- Scoped Yjs on prose fields (Phase 3 above).
- Permissions / role-based UI gating.
- Managed sync infrastructure choice.

---

## 8. Master list (one screen)

**IS:** typed-block content runtime · files-are-truth · schema-driven · multi-persona surfaces · git-native versioning · agency-friendly handoff · headless-first API · framework-adaptable · drafts via status field · references first-class · scoped collab when needed.

**IS NOT:** a general-purpose database · a UGC platform · an application backend · a key-value store · a cache · a transactional system · a real-time-collab tool first · a build pipeline · a CDN · an image transformer · a hosting product.

**Good fits:** SaaS marketing site (landing, pricing, features, blog) · documentation site needing more structure than markdown · agency-built brand sites with client handoff · multi-brand portfolios under one schema · content that must round-trip code review and CMS edits · migrations off Contentful/Sanity for teams that don't need the full power.

**Anti-fits:** e-commerce catalog with 100k+ SKUs · social-network-scale UGC · auth/sessions/orders/transactional app data · real-time collaborative documents (use Notion/Google Docs) · cross-millions-of-rows joins.

---

## 9. Decisions and open questions (post-research)

### Resolved by research

1. **Prose format → Portable Text.** Decided. Existing spec, framework-agnostic serializers, designed for collab. (§4.3.)
2. **Prose-only CRDT precedent → none in production.** Confirmed novel. Sanity is the closest; it uses patch/OT-style mutations across a unified document, not the split we propose. This is a real wedge to claim. (§5.)
3. **Editor competition → Keystatic is the strongest "files + admin" contender, and falls short on three concrete axes:** (a) treats long-form prose as MDX/Markdown, not typed-block JSON; (b) GitHub mode requires server-side compute at runtime (the "deploy anywhere static" pitch is undermined); (c) preview is a known unaddressed gap ([Issue #637](https://github.com/Thinkmill/keystatic/issues/637), labeled "roadmap" with no shipped solution). TinaCMS bleeds ~800–900 KB into production bundles ([Issue #771](https://github.com/tinacms/tinacms/issues/771)). Decap is unmaintained. Pages CMS has limited collection-relation support. **The "files-as-truth + typed-block UI" lane is functionally empty.**
4. **Astro Content Layer overlap → minimal.** Astro deliberately ships no editor surface — "non-technical users given access to a GitHub repository will see a file tree, not an editorial interface" ([sitepins](https://sitepins.com/blog/visual-editor-for-astro-websites)). `clear` differentiates on typed blocks + multi-persona admin. We integrate *via* Astro Content Layer as a loader; we don't compete with it.
5. **MDX as output format → yes, but only for markdown-friendly collections.** Portable Text is the storage format; a Portable Text → MDX renderer is a build-time concern, not a storage concern. Ship `clear export markdown` for blog/docs collections.

### Sharpened, still need a call

6. **Schema DSL shape.** The research did not surface a winner here. Velite, Fumadocs source, and Astro Content Collections all use Zod-with-extras patterns; none of them model typed blocks. Recommended path: define a thin `clear` DSL on top of Zod (`block`, `ref`, `prose`) and ship a one-page spec. Decision deferred until the §10 spec is started.
7. **SQLite cache schema.** No precedent productizes this for a CMS. Borrow PocketBase's two-SQLite topology ([deepwiki](https://deepwiki.com/pocketbase/pocketbase)) — `data.db` for content index, `auxiliary.db` for logs/audit. Use SQLite generated columns over JSON1 ([Lobsters](https://lobste.rs/s/imyxxn/modern_sqlite_generated_columns)) so `clear` doesn't need its own ETL. Collection schemas declare which JSON paths get indexed columns; FTS5 is opt-in per collection.
8. **Agency handoff requirements.** Research couldn't surface concrete RFC-quality requirements (sources are vendor-marketing-heavy). Need direct interviews with 3–5 agencies before locking the persona model. Until then: design the permission system as data (roles → allowed mutations) rather than code.
9. **Auth / permissions placement.** Recommend: middleware in `clear` runtime, NOT in bucket. Bucket should remain auth-free (its adapter is trusted). `clear` evaluates roles against operations and rejects writes the persona isn't allowed to make.
10. **Recursive / nested blocks.** Hygraph hard-caps at 4 levels of nesting. Storyblok allows arbitrary nesting and "depth gets unwieldy" in practice. Decision: allow nested blocks, but the schema must declare `maxDepth` per block type (default 2). Forces explicit thinking instead of accidental complexity.

### New open question surfaced by research

11. **Scale envelope honesty.** GitHub recommends ≤3K entries per directory; Decap reports ~10K total entries with relations is the soft ceiling. We need to publish a benchmark for `clear` on a real corpus (target: 5K documents, p95 cold-start under 2s, p95 query under 50ms with the SQLite cache). Without published numbers we will inherit Decap's reputation.

---

## 10. What to push on next

Two design artifacts unlock the most parallel work:

- **The schema DSL spec** — pin §4.1's shape. Once frozen, the form UI, visual canvas, and migration scripts all have a target. (§9.6.)
- **The on-disk layout for a `clear` site** — what `clear init` scaffolds, what's in `content/`, `assets/`, `_blobs/`, what `git diff` looks like for a typical edit. This is also the migration target.

Schema DSL is higher leverage if implementation is starting; on-disk layout is higher leverage if a first migrating customer is the next milestone.

---

## 11. Market evidence (research extract)

The strongest concrete evidence for the opening, with sources. Use these to brief partners, write a launch post, and prioritize.

### The pattern nobody ships

> "No system pairs typed-block files-as-truth with a schema-driven multi-persona admin UI. Keystatic gets close (typed config + admin) but treats long-form content as MDX/Markdown, not as typed-block JSON. Sanity has typed blocks (Portable Text) but stores them in Content Lake. Astro Content Collections + Zod has the typing but no admin at all." (Research §G1.)

> "Files-as-truth + DB-as-index is widely discussed as a pattern but no CMS productizes it." (Research §G3.)

### Editor pain in current tools

- "The biggest complaint about headless CMS has always been 'content editors can't see what they're building.'" — [builder.io](https://www.builder.io/blog/the-problem-with-a-headless-cms)
- "Form-based platforms like Contentful and Strapi … that promise 'visual editing' and 'marketing autonomy' but actually require developer tickets for routine content changes." — [CSS-Tricks](https://css-tricks.com/reconciling-editor-experience-and-developer-experience-in-the-cms/)
- Keystatic preview gap: "There should be preview button in admin … This missing is constant annoyance." — [Issue #637](https://github.com/Thinkmill/keystatic/issues/637), unanswered.
- TinaCMS production cost: "TinaCMS being almost as large as the median uncompressed bundle size, which is a huge obstacle for using Tina with production sites." — [Issue #771](https://github.com/tinacms/tinacms/issues/771)
- Headless regression: "With headless, microservices and decoupled being the mantra … the authoring experience has taken a step back in importance." — [CMSWire](https://www.cmswire.com/digital-experience/content-teams-beware-the-headless-cms/)
- Real reaction: "Client opened Sanity Studio and immediately noped out … Built the site on Payload. Now I handle all content edits myself." — [contentzen Reddit deep-dive](https://medium.com/@contentzen/what-headless-cms-users-really-care-about-in-2025-a-reddit-deep-dive-with-notes-from-contentzen-2e61b18b8b68)
- Astro gap: "Non-technical users given access to a GitHub repository will see a file tree, not an editorial interface, and cannot edit content without understanding Git, Markdown syntax, and file structure." — [sitepins](https://sitepins.com/blog/visual-editor-for-astro-websites)

### Landscape thinning

- Decap (formerly Netlify CMS): "Netlify officially stopped supporting it … no longer actively maintained." ([luckymedia](https://www.luckymedia.dev/compare/decap-cms-vs-tina-cms))
- Contentlayer: abandoned post-Netlify acquisition of Stackbit.
- Payload: acquired by Figma in June 2025; Payload Cloud paused new sign-ups during transition.
- Triplit: acquired by Supabase in 2025. Local-first sync-engine market is consolidating.

### What competitors get wrong that `clear` will not

| Competitor mistake | Source | What `clear` does |
|---|---|---|
| Bleed editor JS into production page | TinaCMS Issue #771 | Editor is a separate web app; production frontend ships zero `clear` JS. |
| Require server compute for "static" deploy | Keystatic GitHub mode | Production reads via Astro Content Layer or pre-built JSON; bucket reads are static-friendly. |
| Treat preview as a roadmap item | Keystatic Issue #637 | Preview is a Phase B requirement, not a future. |
| Mix presentation with content | MDX-with-arbitrary-JSX trap | Portable Text. Components named, not embedded. |
| Cap nesting arbitrarily without semantics | Hygraph 4-level hard limit | Per-block `maxDepth` declared in schema. |
| Pretend editorial collab is a 1.0 feature | Contentful 25% inadequate ([webstacks](https://www.webstacks.com/blog/headless-cms-content-editor-experience-platform-comparison)) | Single-user first, novel split when collab arrives. |

### Patterns to borrow with credit

- **Portable Text** for prose ([spec](https://github.com/portabletext/portabletext)).
- **Sanity's Mutator/Listener architecture** for the optimistic-UI store, when collab arrives ([ARCHITECTURE.md](https://github.com/sanity-io/sanity/blob/main/ARCHITECTURE.md)).
- **PocketBase's two-SQLite split** (data + auxiliary) for the derived index topology ([deepwiki](https://deepwiki.com/pocketbase/pocketbase)).
- **Astro Content Layer's loader interface** for ingestion adapters into the SQLite index.
- **Notion's uniform block model** as proof that a single block primitive scales (200B blocks at peak, with sharding) — relevant for `clear`'s "everything is a typed block" framing.
- **WordPress Gutenberg's HTML-comment-delimited block grammar** as a precedent if a hybrid-readable block format is ever needed ([parser](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-block-serialization-default-parser/)).
