/**
 * Formatting guide shown in the importer: what the parser expects for each kind of entry.
 * All examples are written for this module (no rulebook text).
 */
export const FORMAT_GUIDE = [
    {
        id: 'npc', label: 'NPC or grunt (stat block)', types: ['character'],
        notes: [
            'First line: the name. "Name: short description" also works.',
            'Lines between the name and the attribute table become the biography.',
            'Attribute header B A R S W L I C ESS (add EDG, M or RES as needed), then the values. 4(5) means 4 base, 5 augmented.',
            'Then one section per line, each starting with its label: Initiative, Condition Monitor, Limits, Armor, Skills, Knowledge Skills, Languages, Qualities, Augmentations, Gear, Weapons, Spells, Adept Powers, Complex Forms, Programs, Contacts, Tradition, Initiate Grade.',
            'List items are separated by commas. Stats go in brackets: Name [Category, Acc 5, DV 8P, AP -1, SA, 15(c)].',
            'A single Condition Monitor number (10) marks a grunt; 10/11 gives separate physical and stun monitors.',
            'Separate several NPCs with a blank line or ---.',
        ],
        example: `Dock Boss (Professional Rating 3)
Runs the night shift at the container yard and takes a cut of everything that moves.
B A R S W L I C ESS
5 3 4(5) 5 4 3 4 4 5.8
Initiative 8 + 1D6
Condition Monitor 11/10
Limits Physical 7, Mental 5, Social 6
Armor 12
Skills Clubs 5, Intimidation (Interrogation) 5 (+2), Negotiation 4, Pistols 4, Perception 3
Knowledge Skills Smuggling Routes 4, Union Politics 3
Languages English N, Cantonese 2
Qualities Toughness
Augmentations Reaction enhancers 1, Cybereyes (Rating 2) [smartlink]
Gear Armor jacket [12], Commlink (Device Rating 3), 2 doses of jazz
Weapons Wrench [Club, Reach 1, Acc 4, DV (STR+2)P, AP -], Ares Predator V [Heavy Pistol, Acc 5(7), DV 8P, AP -1, SA, 15(c)]`,
    },
    {
        id: 'critter', label: 'Critter', types: [],
        notes: [
            'Same layout as an NPC. A Weaknesses line, or Powers with no gear and no metatype, marks it as a critter.',
            'Powers become critter powers; Optional Powers are added switched off.',
        ],
        example: `Alley Stalker
A sleek, hairless hunter that nests in abandoned subway tunnels.
B A R S W L I C EDG ESS M
4 5 5 4 3 2 5 2 3 6 3
Initiative 10 + 2D6
Condition Monitor 10/10
Skills Perception 5, Sneaking 5, Unarmed Combat 4
Powers Dual Natured, Enhanced Senses (Low-Light Vision, Smell), Natural Weapon (Claws: DV (STR+1)P, AP -1)
Weaknesses Allergy (Sunlight, Mild)`,
    },
    {
        id: 'spirit', label: 'Spirit', types: ['spirit'],
        notes: [
            'Put the Force in the name: "(Force 5)". The spirit type comes from the name (Spirit of Fire, Earth Spirit...).',
            'Attributes are relative to Force: F, F+2, F-1. Skills without ratings use the Force.',
        ],
        example: `Spirit of Fire (Force 5)
B A R S W L I C EDG ESS M
F+1 F+2 F+3 F-2 F F F+1 F F/2 F F
Skills Assensing, Astral Combat, Exotic Ranged Weapon, Flight, Perception, Unarmed Combat
Powers Accident, Astral Form, Elemental Attack, Energy Aura, Engulf, Materialization, Sapience
Optional Powers Fear, Guard
Weaknesses Allergy (Water, Severe)`,
    },
    {
        id: 'sprite', label: 'Sprite', types: ['sprite'],
        notes: ['Put the Level in the name: "(Level 4)". Matrix attributes are relative to Level: L, L+1, L+3.'],
        example: `Courier Sprite (Level 4)
Attack L, Sleaze L+3, Data Processing L+1, Firewall L+2
Initiative (L x 2) + 1 + 4D6
Skills Computer, Hacking
Powers Cookie, Hash`,
    },
    {
        id: 'vehicle', label: 'Vehicle or drone', types: ['vehicle'],
        notes: [
            'A table: header row with Handl Speed Accel Bod Armor Pilot Sensor (Seats) Avail Cost, then one vehicle per row.',
            'On-road/off-road values are written 4/3. A table without Seats (or a heading like DRONES) makes drones.',
        ],
        example: `GROUNDCRAFT HANDL SPEED ACCEL BOD ARMOR PILOT SENSOR SEATS AVAIL COST
Sample Scooter 4/3 3 1 4 4 1 1 1 - 3,000¥
Sample Sedan 4/3 3 1 11 6 1 2 4 - 16,000¥

DRONES HANDL SPEED ACCEL BOD ARMOR PILOT SENSOR AVAIL COST
Sample Spy Drone 4 3 2 1 0 3 3 8 2,000¥`,
    },
    {
        id: 'weapon', label: 'Weapons', types: ['weapon', 'ammo'],
        notes: [
            'One weapon per line: name, then its stats. With a header row (ACC DAMAGE AP MODE RC AMMO AVAIL COST) values are read by column; without one, by their shape.',
            'A heading such as HEAVY PISTOLS, BLADES or ASSAULT RIFLES sets the category, skill and range band.',
            'Damage codes: 8P, 9S(e), (STR+2)P. Ammo: 15(c), 6(cy), 2(b). Accuracy 5(7) keeps 5; on NPCs the bracketed value is used.',
            'Labeled form also works: Name / Type: Weapon (Heavy Pistol) / Acc: 5 / DV: 8P / AP: -1 / Mode: SA / Ammo: 15(c) / Avail: 5R / Cost: 725¥.',
        ],
        example: `HEAVY PISTOLS ACC DAMAGE AP MODE RC AMMO AVAIL COST
Sample Heavy Pistol 5(7) 8P -1 SA - 15(c) 5R 725¥

BLADES
Sample Axe 4 2 (STR+5)P -4 12R 4,000¥
Sample Knife 5 1 (STR+1)P -1 - 10¥`,
    },
    {
        id: 'armor', label: 'Armor and clothing', types: ['armor'],
        notes: [
            'Name, Armor rating, Capacity, Avail, Cost. Use a heading such as ARMOR or a header row (ARMOR CAPACITY AVAIL COST) when the name doesn\'t say it\'s armor.',
            'A leading + marks an accessory: Sample Helmet +2 6 2 100¥.',
        ],
        example: `ARMOR
Sample Suit 9 5 9 2,600¥
Sample Jacket 12 12 2 1,000¥
Sample Helmet +2 6 2 100¥`,
    },
    {
        id: 'ware', label: 'Cyberware and bioware', types: ['cyberware', 'bioware'],
        notes: [
            'Name, Essence, Capacity, Avail, Cost. A heading (HEADWARE, CYBERLIMBS, BIOWARE) or header row (ESSENCE CAPACITY AVAIL COST) helps; fractional Essence is recognised on its own.',
            'Grade in the name or brackets: (alphaware), (betaware). Bioware is recognised by name.',
            'Cyber-weapons can carry attack stats: Sample Spur [Acc 6, DV 7P, AP -2].',
        ],
        example: `HEADWARE ESSENCE CAPACITY AVAIL COST
Sample Datajack 0.1 - 2 1,000¥
Sample Headlink 0.2 [2] 4 2,000¥

BIOWARE
Sample Muscle Toner 0.2 - 8R 3,200¥`,
    },
    {
        id: 'gear', label: 'Gear, commlinks, programs', types: ['equipment', 'device', 'program', 'sin', 'lifestyle', 'modification'],
        notes: [
            'Gear: Name, Rating, Avail, Cost - or labeled: Name Rating: 6 Avail: 6 Cost: 1,500¥.',
            'Commlinks and decks: header DEVICE RATING DATA PROCESSING FIREWALL AVAIL COST, or ATTRIBUTE ARRAY for decks (6 5 4 3).',
            'Headings such as COMMLINKS, CYBERDECKS, HACKING PROGRAMS or WEAPON ACCESSORIES set the type.',
        ],
        example: `Sample Medkit Rating: 6 Avail: 6 Cost: 1,500¥

COMMLINKS DEVICE RATING DATA PROCESSING FIREWALL AVAIL COST
Sample Commlink 3 3 3 6 1,000¥`,
    },
    {
        id: 'spell', label: 'Spells and rituals', types: ['spell', 'ritual'],
        notes: [
            'Name on its own line, descriptors in brackets after it or on the next line: (DIRECT), (INDIRECT, ELEMENTAL), (ACTIVE, AREA).',
            'Then Type: M or P, Range: T / LOS / LOS (A), Damage: P or S, Duration: I / S / P, DV: F - 3.',
            'A heading such as COMBAT SPELLS sets the category. A plain list of names under a heading is fine too.',
        ],
        example: `COMBAT SPELLS

SAMPLE BOLT (DIRECT)
Type: M • Range: LOS • Damage: P
Duration: I • DV: F - 3
A bolt of pure mana aimed at one target.`,
    },
    {
        id: 'adept', label: 'Adept powers', types: ['adept_power'],
        notes: ['Name, then Cost: in PP and Activation: (Passive, Free, Simple, Complex).'],
        example: `SAMPLE REFLEXES
Cost: 1.5 PP (level 1), 2.5 PP (level 2)
Activation: Passive
Faster reactions in combat.

SAMPLE STRIKE
Cost: 0.5 PP
Activation: Free Action`,
    },
    {
        id: 'quality', label: 'Qualities', types: ['quality'],
        notes: [
            'Name, then Cost: N Karma (positive) or Bonus: N Karma (negative), then the description.',
            'One-line forms: Name (9 Karma), Name: 9 Karma, Name Cost: 9 Karma.',
            'Lists under POSITIVE QUALITIES / NEGATIVE QUALITIES headings: Name 9.',
        ],
        example: `POSITIVE QUALITIES
Sample Grit (9 Karma)
Sample Hands: 4 Karma

SAMPLE FLAW
Bonus: 5 to 25 Karma
Something that makes life harder.`,
    },
    {
        id: 'complex', label: 'Complex forms', types: ['complex_form'],
        notes: ['Name, then Target:, Duration: (I/S/P) and FV: L + 2.'],
        example: `SAMPLE PUPPET
Target: Device • Duration: I • FV: L + 4
Forces a device to perform one action.`,
    },
    {
        id: 'critterpower', label: 'Critter and sprite powers', types: ['critter_power', 'sprite_power'],
        notes: ['Name, then Type: M/P, Action: Auto/Free/Simple/Complex, Range: Self/Touch/LOS, Duration: Always/Instant/Sustained.'],
        example: `SAMPLE AURA
Type: P • Action: Auto • Range: Touch • Duration: Always
The critter is surrounded by crackling energy.`,
    },
    {
        id: 'contact', label: 'Contacts', types: ['contact'],
        notes: ['Name: ..., Type: Contact (or the archetype), Connection: N, Loyalty: N. On NPCs: Contacts Fixer (Connection 4, Loyalty 2).'],
        example: `Name: Sample Fixer
Type: Contact
Connection: 4
Loyalty: 2`,
    },
    {
        id: 'json', label: 'JSON', types: [],
        notes: [
            'Foundry "Export Data" files (one document, an array, or {"actors": [...], "items": [...]}) import as they are, with their items and effects.',
            'Simplified items: {"type": "weapon", "name": "...", "accuracy": "5(7)", "damage": "8P", "ap": -1}. Simplified actors take attributes, skills, weapons, gear, spells... (see samples/examples.json).',
        ],
        example: `{"items": [
  {"type": "weapon", "name": "Sample Heavy Pistol", "category": "Heavy Pistol", "accuracy": "5(7)", "damage": "8P", "ap": -1, "mode": "SA", "ammo": "15(c)", "avail": "5R", "cost": 725},
  {"type": "quality", "name": "Sample Grit", "karma": 9}
],
"actors": [
  {"type": "npc", "name": "Sample Guard", "attributes": {"body": 4, "agility": 3, "reaction": 4, "strength": 3, "willpower": 3, "logic": 2, "intuition": 3, "charisma": 2}, "skills": {"Pistols": 4, "Perception": 3}, "gear": ["Armor Jacket [12]"]}
]}`,
    },
];

/** The guide topic for a system type, if any. */
export function guideTopicFor(type) {
    return FORMAT_GUIDE.find(g => g.types.includes(type))?.id ?? null;
}
