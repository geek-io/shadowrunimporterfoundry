# Shadowrun 5e Importer for Foundry VTT

A Foundry VTT v13 and v14 module for the [Shadowrun 5th Edition system](https://github.com/SR5-FoundryVTT/SR5-FoundryVTT) that imports Shadowrun 5e content from JSON, plain text and PDF.

- Module by: Geek IO Dev Team

[Official Geek IO Discord Link](https://www.geek-io.net/discord)

<a href="https://patreon.com/geekioshow"><img src="assets/Patreon-Logo.png" alt="All my work is always free, but a little bit of help is always appreciated" width="240"></a>

# v 0.1.9

Tested end to end on the Shadowrun Missions adventure Dirty Laundry: every NPC, critter, spirit, drone, host and contact comes through.

- **Names over several lines with a role line under them.** `PRIVATES ERIN MENKAS` / `AND PHILIP ROE` / `HUMAN UCAS MARINES` gives the name "Privates Erin Menkas and Philip Roe". The role line sets the metatype and goes into the biography. This also works for names with periods or nicknames (`LT. FRANCOIS` / `“STEREOTYPE” ABELLARD`), for `MELEK, ELVEN` / `TOXIC SHAMAN`, and for names printed in normal case (`Warrant Officer` / `Chris Jenkins` / `Dwarven U.C.A.S. Marine Pilot`).
- **NPCs printed twice are merged.** Adventures often print an NPC in a scene and again in the cast pages at the back, with small typos between the copies. When the name, type and attributes match, the importer now makes one entry: it keeps the fuller copy and adds anything only the other copy has (an item, a skill, a longer description). The entry is marked "Printed twice in the source" so you can check the sheet. Scenes that use different numbers keep both ("Appears: 2 per runner or 1 per runner").
- **"Per runner" counts:** `(2 PER RUNNER, PROFESSIONAL RATING 1)`, `(1 PER RUNNER) (PROFESSIONAL RATING 1)` and `(12 + 3 PER RUNNER)` are read, and the count goes into the biography ("Appears: 2 per runner").
- **Drone names with a count:** `UCAS MCT-NISSAN` / `ROTO-DRONE (2)` becomes "UCAS MCT-Nissan Roto-Drone", a group of 2, and an aircraft. Abbreviations such as UCAS, MCT, GMC and HK keep their capitals.
- **Model numbers stay in weapon names:** "HK 227", "Fichetti Security 600" and "Ultimax 70" are no longer cut to "HK" with a rating of 227.
- **Augmentation lists** that start with a grade for all of them (`[all betaware] Bone Density 4, Orthoskin Rating 4, Pain Editor`) give every item that grade. A wrapped line that starts with "Rating 4," no longer ends the list early.
- **Book misprints handled:** a gear list with a missing comma between two items (`…helmet [w/ chemseal] Hermes Ikon commlink`), a `(Gear:` line whose parenthesis is never closed, and an attribute table headed `ESS ESS` where the first is Edge.

# v 0.1.8

Tested end to end on Bloody Business (162 pages): all 67 NPCs, spirits, critters and vehicles come through with their names, stats, skills and gear.

- **PDFs with scrambled text are decoded.** Some PDFs use fonts with no character table, so their text comes out as nonsense ("8LI" for "The"). The importer now detects this and decodes it, including apostrophes, quotes and dashes. Letters it cannot work out, mostly accented ones such as the á in Bogotá, show as �. A note in the importer says when a PDF was decoded.
- **Characters that used to vanish from such PDFs** (`( ) % & '`) are kept. The bundled pdf.js has a small patch for this.
- **Label-table stat blocks** (a label column and a value column, no colons) import, including labels wrapped over two lines ("Condition / Monitor", "Physical / Initiative", "Knowledge / Skills"), Notes, Bound Spirits, Registered Sprites, Cyberdeck and labels the importer does not know (kept in the notes).
- **More column layouts:** a short description column next to a stat table, and pages with a large chapter title across the top, are read in the right order.
- **Names:** the importer looks further up for a name above a long description, and passes over metatype lines ("FEMALE HUMAN"), running headers, letter-spaced titles and section labels. `PILAR CARRILLO,` over `A.K.A. MOSAIC` becomes "Pilar Carrillo (a.k.a. Mosaic)". A group line such as `(LAW ENFORCEMENT; DWARF, PROFESSIONAL RATING 4)` sets the metatype and rating, and a spirit's `(RATING 7)` is its Force.
- **Values:** attributes written `5 (7)` or `4 (+2)`, initiative written `9 (12) + 1(4)D6` or `8 (9) + D6`, and Essence misprinted under M or EDG.
- **Skills:** specializations with brackets inside ("Tae Kwon Do w/ … [Block] …"), dice pools such as `Pistols [8]`, `Intimidation (6)*`, `group7` and "Sneak".
- **Gear and weapons:** brackets the book closes with the wrong mark or never closes are repaired, an item wrapped over two lines inside brackets stays whole, sentences in a Weapons list go to the notes, and `*` footnotes go to the notes. An AP printed without its minus sign ("AP 5", where the PDF dropped the dash) is read as negative.
- A heading such as CRITTER POWERS no longer carries on into the story text after it.
- Story-text lines starting with a lowercase word ("knowledge to formulate…") are no longer read as stat labels.

# v 0.1.7

Tested end to end on a full Shadowrun Missions adventure PDF: every NPC, spirit, vehicle, host and contact now comes through.

- **PDF pages read in the right order throughout.** Columns are found even when a paragraph runs across both of them, sidebars that share the text's line spacing are still left out, and a running footer such as "SCENE 3: THE DIRECT ROUTE" no longer swallows the last line of a column.
- **One stray word no longer breaks the rest of the book.** A line of story text such as "bikes." was read as a BIKES heading and turned every later NPC into a vehicle; headings now have to look like headings.
- **Insect spirits:** `HYBRID FORM` with `(FORCE 5 SOLDIER ANT SPIRITS, 3)` becomes a spirit actor named "Soldier Ant Spirit (Hybrid Form)", with Force 5, the soldier spirit type, a group of 3 and the printed attributes. Flesh, true and hybrid forms of ant, wasp and roach spirits all work.
- **Bound spirits:** `(1, FORCE 7, BOUND, 3 SERVICES)` sets the spirit as bound with 3 services.
- **Contact cards** from player handouts (name, role, Connection Rating, Key Active Skills, Knowledge Skills, Uses) import as contacts with the card's description. The three copies printed on a handout page import once.
- Identical entries printed twice in a book are imported once.
- Adventure section headings (Cast of Shadows, Behind the Scenes, Debugging, Scene 6 (Optional)...) are never taken for an NPC's name and always end the stat block before them.
- Initiative written as `9(10) + 3D6` uses the augmented value.
- "Unique Qualities:", "Bound Spirits:" and vehicle "Upgrades:" lines go into the notes instead of onto the end of a list. Vehicles keep their programs and weapons, and rotor drones are aircraft.
- Skill fixes: a skill group named without the word "group" (`Conjuring 4`) applies to its skills, `Law Enforcement 3 (Professional Knowledge)` in an active skills list becomes a knowledge skill, and "Assessing" is read as Assensing. Ratings written before a detail (`Critical Strike 1 (Unarmed)`) are read.
- Ammunition entries such as KEV Ammunition import as ammo.
- Story text, credits and GM notes are left out without the "table line(s) could not be read" warning; that warning now only appears for table rows that really could not be read.

# v 0.1.6

- **Matrix hosts import.** A host written as `Host: Name` (or `HOST: NAME`), the `Rating Attack Sleaze Data Proc. Firewall` table and labeled lines (Installed IC, Slaved Devices, Sculpting, Security Procedures, Pay Data) becomes a host item. Rating and the four matrix attributes go on the sheet as printed, and the labeled lines go into the description. Hosts printed among an adventure's NPCs are picked out, and the NPCs around them are still imported. Hosts have their own page in the formatting guide.
- **PDF columns are read properly.** Column detection now finds the gutters on each page instead of assuming a split down the middle, so pages with two columns and a navigation sidebar no longer come out with lines from different columns mixed together. Side navigation tabs (INTRODUCTION, SCENE 1...), page numbers and running headers are left out, titles that cross both columns are kept in place, and full-page gear tables are not split.
- **Adventure-style NPC headings:** names printed over two capitalised lines ("HYBRID ANT" / "SPIRIT SOLDIERS") are joined, and a line such as `(4, PROFESSIONAL RATING 3)` or `(2, FORCE 5)` sets the Professional Rating or Force and notes the group size in the biography instead of being copied into the description.
- In stat blocks that write labels with a colon (`Skills:`), a wrapped list line that starts with a section word ("Throwing" / "Weapons 4, Unarmed Combat 5") stays in the list.
- Insect spirit names in the plural ("Spirit Soldiers") get their spirit type.

# v 0.1.5

- **Formatting guide in the importer.** Under Parsing, open **Formatting guide** and pick a kind of entry (NPC, critter, spirit, sprite, vehicle, weapons, armor, ware, gear, spells, adept powers, qualities, complex forms, powers, contacts or JSON) to see the layout the importer expects, with an example. **Insert example** puts the example in the text box. Choosing a type under *Force type* opens its guide, and the guide opens on its own when nothing could be read.
- **Armor rows import.** A line such as `Berwick Suit 9 5 9 2,600¥` becomes armor with Armor 9, Capacity 5, Avail 9 and Cost 2,600¥, with or without an `ARMOR` heading.
- **Qualities import** from more layouts: `Toughness (9 Karma)`, `Toughness: 9 Karma`, `Toughness Cost: 9 Karma`, `Bonus: 5 to 25 Karma` (negative), `QUALITY KARMA` tables, and `Name 9` lists under a `POSITIVE QUALITIES` or `NEGATIVE QUALITIES` heading.
- Labeled gear lines such as `Medkit Rating: 6 Avail: 6 Cost: 1,500¥` import as equipment.
- Sprites and other actors written with `Attack L, Sleaze L+3, ...` attribute lines get those attributes instead of a description.

# v 0.1.4

- **Stat blocks copied from PDFs import completely.** Blank lines inside skill and gear lists no longer cut the NPC short, so every skill and item is kept. Words split across lines ("Semi-/Automatics", "frighten-/ing") are joined back together, and description paragraphs broken by stray blank lines are rejoined.
- **"Name: description" titles.** A first line such as "Lieutenant: Gangers who've…" gives the name "Lieutenant", and the rest goes into the biography.
- **Gear lists:** weapons listed under Gear (with Acc/DV stats) become weapons, "1 dose of …" sets the quantity, and page references like "(p. 411)" go to the item's source.
- **Cyber-weapons** such as a retractable spur keep their Accuracy, Damage and AP and attack with Unarmed Combat.
- **Thrown Weapons** is recognised as the Throwing Weapons skill.
- **Essence** below 6 (for example 5.7) is matched with an effect.
- **Weapons no longer get a description** when their stats were parsed, since every value is already in its own field on the sheet.
- Checked with the SR5 Redesign sheet module: the importer writes the system's standard data, which that sheet displays.

# v 0.1.3

- **NPC descriptions are imported.** The text between an NPC's name and its attribute table (a description paragraph, a short tag line, or a `Description:` line) goes into the actor's biography. NPCs with a description paragraph are no longer named "Unnamed", and a `Description:` line no longer turns the NPC into an equipment item.
- **No more pasted source text in descriptions.** Items and actors no longer get a copy of the text you pasted. Items get the labeled stat line and any description; actors get their description, notes and details such as Professional Rating and Tradition.

# v 0.1.2

- **Gear rows without a header line** are now read correctly. A line such as `Combat axe 4 2 (STR + 5)P -4 12R 4,000¥` becomes an item named "Combat axe" with its Accuracy, Reach, Damage, AP, Avail and Cost filled in. This works under a heading like `BLADES`, with a forced type, on its own, in a stat block's Weapons list, and for table rows with a missing or extra column.
- **Cleaner descriptions.** Parsed items get a labeled stat line as their description, for example "Name: Combat axe, Accuracy: 4, Reach: 2, Damage: (STR + 5)P, AP: -4, Avail: 12R, Cost: 4,000¥", followed by any description text from the source. The original source text is only used when nothing could be parsed.

# v 0.1.1

- Bug fixes

# v 0.1.0

**First release.** One importer for every kind of Shadowrun 5e content: NPCs, grunts, critters, spirits, sprites, IC, vehicles and drones, plus weapons, armor, ware, gear, spells, powers, qualities, complex forms and more, many entries at a time.

- **Importer window.** Click **SR5 Importer** at the top of the Actors, Items or Compendium sidebar. It has three steps:
  - **Source:** paste text or JSON, or drop files (JSON, .txt, .md, PDF; several at once). Text files and extracted PDF text go into the text box so you can tidy them first. Separate unrelated entries with a line of `---`.
  - **Preview:** every entry found is listed with its type and key stats. Untick what you don't want, rename entries, change an entry's type (it is re-read as that type), or expand an entry to edit its creation data.
  - **Import:** choose where actors and items go (the world or any unlocked compendium), optional folders (`NPCs/Gangers` creates both levels), and what happens when a document with the same name and type exists: skip, replace, or import a copy.
- Entries stay listed after importing. Imported ones are unticked so a second click doesn't duplicate them.
- **Many entries at once** from pasted text, several files, or a whole PDF chapter. Stat blocks that follow each other without blank lines are split correctly, and a stat block stops where the next item entry or table begins.
- **NPC and grunt stat blocks** become Character actors. The importer reads:
  - the `B A R S W L I C ESS` table, including values such as `4(5)`
  - Initiative, Condition Monitor, Limits and Armor
  - Skills (with specializations and skill groups), Knowledge Skills and Languages (`English N`)
  - Qualities, Augmentations, Gear, Spells, Adept Powers, Complex Forms, Programs and Contacts
  - Weapons, such as `Ares Predator V [Heavy Pistol, Acc 5(7), DV 8P, AP -1, SA, 15(c)]`
  - Tradition (sets the drain attribute) and Initiate Grade
- **Grunts** are flagged when the stat block has a single condition monitor.
- **Critters, spirits, sprites, IC, vehicles and drones:**
  - Critters with Powers and Weaknesses, and Optional Powers.
  - Spirits with `F+2` attributes and Force in the title, and sprites with `L+1`. Spirit and sprite types come from the name.
  - Vehicles and drones from `Handl Speed Accel Bod Armor Pilot Sensor Seats Avail Cost`, including `4/3` on-road/off-road values.
- **Owned items** listed on stat blocks (weapons, armor, ware, gear, spells, powers, qualities, complex forms, programs, contacts) are copied from your world Items and Item compendiums when the names match, with the stat block's rating and quantity applied. Items with no match are built from the stat block. The import summary lists any items created with only a name.
- **Skills** use the system's skill items:
  - Default skills get their ratings from the stat block, and specializations are added.
  - Skill groups apply to their skills; a skill listed on its own wins over its group.
  - Knowledge skills and languages are created with the right attribute.
  - Older system versions that keep skills on the actor are supported too.
- **Printed totals are matched** (can be turned off): augmented attributes such as `REA 4(5)` get an "Imported augmentations" effect, and initiative, armor, condition monitors and limits are adjusted to the stat block's numbers.
- **Labeled entries:**
  - Spells such as `Type: M • Range: LOS • Damage: P • Duration: I • DV: F-3`, with descriptors such as `(INDIRECT, ELEMENTAL)`.
  - Adept powers (`Cost: 0.5 PP`, Activation), qualities (`Cost: 7 Karma` / `Bonus: 7 Karma`) and complex forms (`FV: L+1`).
  - Critter powers, and gear with `Name:` / `Type:` labels.
- **Gear tables:** a header row followed by rows, such as `ACC DAMAGE AP MODE RC AMMO AVAIL COST`, `ACC REACH DAMAGE AP AVAIL COST`, `ARMOR CAPACITY AVAIL COST`, `ESSENCE CAPACITY AVAIL COST` or `DEVICE RATING DATA PROCESSING FIREWALL AVAIL COST`.
- **Headings** such as `COMBAT SPELLS`, `NEGATIVE QUALITIES`, `HEADWARE` or `HEAVY PISTOLS` set the type and category for the entries below them.
- **Items of every SR5 type:**
  - Weapons, with skill, range band, firing modes, recoil, ammo and clip type set from the weapon category.
  - Armor and armor accessories.
  - Cyberware and bioware with essence, capacity and grade.
  - Commlinks, cyberdecks and RCCs with matrix attributes.
  - Spells with category, type, range, duration, drain and opposed tests.
  - Programs, ammo, modifications, rituals, adept powers, critter and sprite powers, complex forms, qualities, lifestyles, contacts, SINs, hosts, metamagics and echoes.
- **JSON import:**
  - Foundry *Export Data* files (single, arrays, or `{ "actors": [...], "items": [...] }`), with embedded items and effects.
  - Older exports that use `data` instead of `system`.
  - JSON Lines.
  - A simplified format (see `samples/examples.json`).
- **PDF import** extracts text locally with the bundled pdf.js, with page ranges, one- or two-column layouts and cancellation. Review the extracted text before parsing. Scanned (image-only) pages have no text and are reported.
- **Samples:** the `samples` folder has a stat block file, an item file and a JSON file. Load them from **What can be imported?** in the importer.
- **Macro API:** `game.modules.get('sr5-importer').api.importText(text, { actorFolder: 'NPCs' })` imports without opening the window.
- **Developer checks:** `npm test` runs the parser tests, and `node tests/schema/check.mjs <SR5 system folder>` checks the importer's output against the system's own data models.
