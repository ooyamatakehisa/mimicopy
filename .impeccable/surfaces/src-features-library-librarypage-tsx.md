---
version: 1
slug: "src-features-library-librarypage-tsx"
primary_target: "src/features/library/LibraryPage.tsx"
related_targets: ["src/features/library/LibraryPanel.tsx"]
---

# Library folders

Mode: Operate. Extend the existing library surface and retain the dark green neutral palette and teal selection language. Primary job: find a saved song, organize it, then open it to practice. The user confirmed one-level folders and building the working interface directly.

## Direction contract

THESIS: Give saved audio a stable place. Folder navigation and aligned song rows make organizing a large library direct.

OWN-WORLD: Existing dark green surfaces, pale foreground and teal active states; Lucide icons and shared controls. Use quiet separators and compact rows in the library instead of independently elevated track cards.

STORY: Choose all songs, unfiled songs or a named folder. Search within that view. Select one or more tracks and move them with an explicit destination. Rename inline; deleting a folder keeps its audio.

FIRST VIEWPORT: Import controls stay above the library. A 15rem sidebar carries counts, collection links and folder creation. The main area has a view title, search, optional selection tools and aligned track rows. Small screens place navigation above the rows, keeping names and actions usable without horizontal overflow.

FORM: Local extension of the established library; no concept seed is applicable. The signature interaction is selecting multiple tracks and moving them while both source and destination counts update.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
