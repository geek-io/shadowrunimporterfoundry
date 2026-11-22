# Shadowrun 5e Importer for Foundry VTT

A Foundry VTT v13 and v14 module for the [Shadowrun 5th Edition system](https://github.com/SR5-FoundryVTT/SR5-FoundryVTT) that imports Shadowrun 5e content from JSON, plain text and PDF.

- Module by: Geek IO Dev Team

[Official Geek IO Discord Link](https://www.geek-io.net/discord)

<a href="https://patreon.com/geekioshow"><img src="assets/Patreon-Logo.png" alt="All my work is always free, but a little bit of help is always appreciated" width="240"></a>

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
