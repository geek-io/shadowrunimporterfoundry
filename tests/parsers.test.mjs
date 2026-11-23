// Run with: node --test tests/*.test.mjs  (or npm test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseText } from '../scripts/parsers/text-parser.js';
import { parseJSON } from '../scripts/parsers/json-parser.js';
import { parseDamage, parseAugmented, toNumber, skillKey } from '../scripts/parsers/common.js';
import { buildItem } from '../scripts/build/item-builder.js';
import { buildActor } from '../scripts/build/actor-builder.js';

const sample = name => readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8');

test('common value parsers', () => {
    assert.deepEqual(parseAugmented('5(7)'), { base: 5, augmented: 7 });
    assert.equal(toNumber('1,500¥'), 1500);
    assert.equal(toNumber('-'), 0);
    assert.equal(toNumber('–2'.replace('–', '-')), -2);
    const d = parseDamage('(STR+3)P');
    assert.equal(d.attribute, 'strength');
    assert.equal(d.damage, 3);
    assert.equal(parseDamage('9S(e)').element, 'electricity');
    assert.equal(parseDamage('9S(e)').type, 'stun');
    assert.equal(parseDamage('16P, -2/m').dropoff, -2);
    assert.equal(skillKey('Unarmed Combat'), 'unarmed_combat');
    assert.equal(skillKey('Pistol'), 'pistols');
    assert.equal(skillKey('Gang Turf'), '');
});

test('NPC stat blocks', () => {
    const { records } = parseText(sample('npcs.txt'));
    assert.equal(records.length, 3);
    const [ganger, mage, spirit] = records;

    assert.equal(ganger.type, 'character');
    assert.equal(ganger.name, 'Halloweener Ganger');
    assert.equal(ganger.fields.metatype, 'ork');
    assert.equal(ganger.fields.grunt, true);
    assert.equal(ganger.fields.attributes.body.base, 5);
    assert.ok(ganger.skills.some(s => s.name === 'English' && s.native && s.category === 'language'));
    const knife = ganger.children.find(c => c.name === 'Combat knife');
    assert.equal(knife.type, 'weapon');
    assert.equal(knife.fields.damage, '(STR+2)P');
    assert.equal(ganger.children.find(c => c.name === 'Jazz').fields.quantity, 2);

    assert.equal(mage.fields.attributes.reaction.augmented, 5);
    assert.equal(mage.fields.special, 'magic');
    assert.equal(mage.fields.drainAttribute, 'logic');
    assert.equal(mage.fields.grunt, undefined, 'P/S monitors mean not a grunt');
    assert.deepEqual(mage.skills.find(s => s.name === 'Spellcasting').specs, ['Combat Spells']);
    assert.equal(mage.children.filter(c => c.type === 'spell').length, 5);
    assert.equal(mage.children.find(c => /wired/i.test(c.name)).fields.rating, 1);

    assert.equal(spirit.type, 'spirit');
    assert.equal(spirit.fields.force, 5);
    assert.equal(spirit.fields.spiritType, 'fire');
    assert.equal(spirit.fields.attributes.agility.relative, 2);
    assert.ok(spirit.children.every(c => c.type === 'critter_power'));
    assert.ok(spirit.skills.every(s => s.rating === 5), 'spirit skills default to Force');
});

test('back-to-back stat blocks without separators', () => {
    const text = `PATROL OFFICER (PROFESSIONAL RATING 3)
B A R S W L I C ESS
4 3 4 4 3 3 4 3 6
Condition Monitor 10
Initiative 8 + 1D6
Skills Automatics 4, Firearms group 3
Weapons
Stun baton [Club | Reach 1 | Acc 4 | DV 9S(e) | AP -5]
HELL HOUND
B A R S W L I C EDG ESS M
4 3 5 4 3 2 4 3 3 6 4
Powers Dual Natured, Natural Weapon (Bite: DV (STR+1)P, AP -1, Reach 0)
Weaknesses Allergy (Water, Mild)

Name: Sample Fixer
Type: Contact
Connection: 4
Loyalty: 2`;
    const { records } = parseText(text);
    assert.deepEqual(records.map(r => r.name), ['Patrol Officer', 'Hell Hound', 'Sample Fixer']);
    const [officer, hound, fixer] = records;
    assert.equal(officer.skills.find(s => s.key === 'automatics').rating, 4, 'explicit skill beats group');
    assert.equal(officer.skills.find(s => s.key === 'pistols').rating, 3);
    assert.equal(officer.children[0].name, 'Stun baton');
    assert.equal(hound.fields.critter, true);
    assert.ok(hound.children.find(c => c.name.startsWith('Natural Weapon')).fields.notes.includes('Reach 0'));
    assert.equal(fixer.type, 'contact');
    assert.equal(fixer.fields.type, undefined);
});

test('labeled entries and tables', () => {
    const { records } = parseText(sample('items.txt'));
    const by = name => records.find(r => r.name === name);
    assert.equal(by('Manabolt').type, 'spell');
    assert.equal(by('Manabolt').fields.drain, 'F - 3');
    assert.equal(by('Flamestrike').fields.descriptors, 'INDIRECT, ELEMENTAL');
    assert.equal(by('Improved Reflexes').type, 'adept_power');
    assert.equal(by('Allergy').hint.qualityType, 'negative');
    assert.equal(by('Puppeteer').type, 'complex_form');
    assert.equal(by('Ares Alpha').fields.mode, 'SA/BF/FA');
    assert.equal(by('Katana').fields.damage, '(STR+3)P');
    assert.equal(by('Helmet').type, 'armor');
    assert.equal(by('Datajack').type, 'cyberware');
    assert.equal(by('Hermes Ikon').type, 'device');
    assert.equal(by('Dodge Scoot').type, 'vehicle');
    assert.equal(by('Dodge Scoot').fields.vehicle.vehicleType, 'ground');
    assert.equal(by('MCT Fly-Spy').fields.vehicle.isDrone, true);
});

test('item builder maps onto the SR5 data model', () => {
    const spell = buildItem({ type: 'spell', name: 'Manabolt', fields: { type: 'M', range: 'LOS', damage: 'P', duration: 'I', drain: 'F - 3', descriptors: 'DIRECT' } }).data.system;
    assert.equal(spell.type, 'mana');
    assert.equal(spell.category, 'combat');
    assert.equal(spell.drain, -3);
    assert.equal(spell.combat.type, 'direct');
    assert.equal(spell.action.opposed.attribute, 'willpower');

    const gun = buildItem({ type: 'weapon', name: 'Ares Predator V', fields: { category: 'Heavy Pistols', accuracy: '5(7)', damage: '8P', ap: '-1', mode: 'SA', ammo: '15(c)', avail: '5R', cost: '725¥' } }).data.system;
    assert.equal(gun.category, 'range');
    assert.equal(gun.action.skill, 'pistols');
    assert.equal(gun.action.limit.base, 5);
    assert.equal(gun.action.damage.ap.base, -1);
    assert.equal(gun.ammo.clip_type, 'removable_clip');
    assert.equal(gun.range.ranges.medium, 20);
    assert.equal(gun.technology.cost, 725);

    const owned = buildItem({ type: 'weapon', name: 'Ares Predator V', fields: { accuracy: '5(7)' }, owned: true }).data.system;
    assert.equal(owned.action.limit.base, 7, 'actor-owned weapons use the augmented accuracy');
    assert.equal(owned.technology.equipped, true);

    const helmet = buildItem({ type: 'armor', name: 'Helmet', fields: { armor: '+2' } }).data.system;
    assert.equal(helmet.armor.accessory, true);
});

test('actor builder plans reconcile steps', () => {
    const { records } = parseText(sample('npcs.txt'));
    const mage = buildActor(records[1]);
    assert.equal(mage.data.system.attributes.reaction.base, 4);
    assert.equal(mage.plan.reconcile.attributes.reaction, 5);
    assert.deepEqual(mage.plan.reconcile.initiative.meatspace, { base: 9, dice: 1 });
    assert.equal(mage.data.system.magic.initiation, 1);
    const spirit = buildActor(records[2]);
    assert.equal(spirit.data.system.attributes.force.base, 5);
    assert.equal(spirit.data.system.attributes.agility.applies_special, true);
});

test('JSON: simplified, Foundry exports and wrappers', () => {
    const { records } = parseJSON(sample('examples.json'));
    assert.equal(records.filter(r => r.documentName === 'Item').length, 5);
    const samurai = records.find(r => r.name === 'Sample Street Samurai');
    assert.equal(samurai.fields.attributes.agility.augmented, 6);
    assert.ok(samurai.children.some(c => c.type === 'bioware' && c.name === 'Muscle Toner'));
    assert.equal(records.find(r => r.name === 'Spirit of Air').fields.attributes.body.relative, -2);

    const exported = parseJSON(JSON.stringify([
        { _id: 'abc', name: 'Exported Gun', type: 'weapon', system: { category: 'range' }, folder: 'x', _stats: {} },
        { name: 'Legacy Item', type: 'equipment', data: { technology: { rating: 2 } } },
    ])).records;
    assert.equal(exported[0].native, true);
    assert.equal(exported[0].data._id, undefined);
    assert.equal(exported[0].data.folder, undefined);
    assert.equal(exported[1].data.system.technology.rating, 2);

    const lines = parseJSON('{"type":"spell","name":"A"}\n{"type":"spell","name":"B"}').records;
    assert.equal(lines.length, 2);
});

test('unstructured text is left out quietly', () => {
    const { records, skipped } = parseText('SAMPLE CHAPTER\n\nJust some prose about the Sixth World.');
    assert.equal(records.length, 0);
    assert.equal(skipped.length, 0, 'story text is expected in adventures and is not reported');
});

test('forced type turns a list of names into items', () => {
    const { records } = parseText('Manabolt\nStunbolt\nHeal', { forceType: 'spell' });
    assert.deepEqual(records.map(r => [r.type, r.name]), [['spell', 'Manabolt'], ['spell', 'Stunbolt'], ['spell', 'Heal']]);
});

test('gear rows without a header line', () => {
    const { records } = parseText('BLADES\nCombat axe 4 2 (STR + 5)P -4 12R 4,000¥\nKatana 7 1 (STR+3)P -3 9R 1,000¥');
    assert.deepEqual(records.map(r => r.name), ['Combat axe', 'Katana']);
    const axe = records[0].fields;
    assert.deepEqual([axe.accuracy, axe.reach, axe.damage, axe.ap, axe.avail, axe.cost], ['4', '2', '(STR+5)P', '-4', '12R', '4,000¥']);
    const single = parseText('Combat axe 4 2 (STR + 5)P -4 12R 4,000¥', { forceType: 'weapon' }).records[0];
    assert.equal(single.name, 'Combat axe');
    const gun = parseText('Ares Predator V 5 (7) 8P -1 SA - 15 (c) 5R 725¥', { forceType: 'weapon' }).records[0].fields;
    assert.equal(gun.mode, 'SA');
    assert.equal(gun.ammo, '15(c)');
    const ware = parseText('HEADWARE\nDatajack 0.1 - 2 1,000¥').records[0];
    assert.equal(ware.type, 'cyberware');
    assert.equal(ware.fields.essence, '0.1');
    const { records: npc } = parseText('Thug\nB A R S W L I C ESS\n4 3 3 4 3 2 3 2 6\nWeapons Combat axe 4 2 (STR + 5)P -4');
    assert.equal(npc[0].children[0].name, 'Combat axe');
    assert.equal(npc[0].children[0].fields.reach, '2');
});

test('descriptions hold parsed data, never the pasted source', () => {
    const r = parseText('Combat axe 4 2 (STR + 5)P -4 12R 4,000¥', { forceType: 'weapon' }).records[0];
    const { data } = buildItem({ type: r.type, name: r.name, fields: r.fields });
    assert.equal(data.name, 'Combat axe');
    assert.equal(data.system.description, undefined, 'weapons keep their stats in sheet fields, not the description');
    assert.equal(data.system.melee.reach, 2);
    assert.equal(data.system.action.damage.attribute, 'strength');
    const plain = buildItem({ type: 'equipment', name: 'Odd thing', fields: {} }).data;
    assert.equal(plain.system.description, undefined, 'source text is never copied into the description');
    const { records } = parseText(readFileSync(new URL('../samples/npcs.txt', import.meta.url), 'utf8'));
    const actor = buildActor(records[0]).data;
    assert.ok(!/B A R S W L I C|Imported stat block/.test(actor.system.description?.value ?? ''), 'no stat block dump on actors');
    assert.ok(/armed and bored/.test(actor.system.description.value), 'flavour text is kept');
});

test('NPC descriptions: name, paragraph, Description: label', () => {
    const text = `DOCK BOSS
The dock boss runs the night shift at the container yard with a heavy hand and
a heavier wrench. She knows every smuggler who moves product through the port.

B A R S W L I C ESS
5 3 4 5 4 3 4 4 6
Skills Clubs 5, Intimidation 5
Weapons Wrench [Club, Reach 1, Acc 4, DV (STR+2)P, AP -]

STREET DOC
Description: A tired back-alley surgeon who patches up runners for cash.
B A R S W L I C ESS
2 3 3 2 4 5 4 3 5.2
Skills Medicine 6`;
    const { records } = parseText(text);
    assert.deepEqual(records.map(r => [r.type, r.name]), [['character', 'Dock Boss'], ['character', 'Street Doc']]);
    assert.equal(records[0].fields.description, 'The dock boss runs the night shift at the container yard with a heavy hand and a heavier wrench. She knows every smuggler who moves product through the port.');
    assert.equal(records[1].fields.description, 'A tired back-alley surgeon who patches up runners for cash.');
    const bio = buildActor(records[0]).data.system.description.value;
    assert.ok(bio.startsWith('<p>The dock boss runs'));
    assert.ok(!/B A R S/.test(bio));
});

test('PDF-copied stat block: blank lines inside lists, hyphenation, "Name: description"', () => {
    const text = `Enforcer: Toughs who have roughed up enough shop
owners get promoted to keep the newer recruits in

line, and they enjoy it a little too much for any-
one's comfort.

B A R S W L I C ESS
4 4 4 4 4 3 4 4 5.7
Initiative 8 + 1D6
Condition Monitor 10
Armor 12
Skills Blades 3, Etiquette (Street) 4 (+2),

Intimidation 4, Pistols (Semi-
Automatics) 3 (+2), Thrown Weapons 2,

Unarmed Combat (Cyberimplants) 3 (+2)

Augmentations Retractable spur [Acc 6, DV 7P, AP –2]
Gear Armor jacket [12]

Browning Ultra-Power [Heavy Pistol, Acc 5
(6), DV 8P, AP –1, SA, RC —, 10 (c)]
Knife [Blade, Acc 5, Reach —, DV 5P, AP –1]
Sony Emperor commlink (Device Rating 2)
1 dose of cram or jazz (p. 411)`;
    const { records, skipped } = parseText(text);
    assert.equal(records.length, 1);
    assert.deepEqual(skipped, []);
    const [r] = records;
    assert.equal(r.name, 'Enforcer');
    assert.equal(r.fields.description, "Toughs who have roughed up enough shop owners get promoted to keep the newer recruits in line, and they enjoy it a little too much for anyone's comfort.");
    assert.deepEqual(r.skills.map(s => [s.key, s.rating]), [['blades', 3], ['etiquette', 4], ['intimidation', 4], ['pistols', 3], ['throwing_weapons', 2], ['unarmed_combat', 3]]);
    assert.deepEqual(r.skills.find(s => s.key === 'pistols').specs, ['Semi-Automatics']);
    assert.deepEqual(r.children.map(c => [c.type, c.name]), [
        ['cyberware', 'Retractable spur'], ['armor', 'Armor jacket'], ['weapon', 'Browning Ultra-Power'],
        ['weapon', 'Knife'], ['device', 'Sony Emperor commlink'], ['equipment', 'Cram or jazz'],
    ]);
    const spur = buildItem({ type: 'cyberware', name: 'Retractable spur', fields: r.children[0].fields, owned: true }).data.system;
    assert.equal(spur.action.damage.base, 7);
    assert.equal(spur.action.skill, 'unarmed_combat');
    const gun = buildItem({ type: 'weapon', name: 'Browning Ultra-Power', fields: r.children[2].fields, owned: true }).data.system;
    assert.equal(gun.action.limit.base, 6);
    assert.equal(gun.description, undefined, 'fully parsed weapons get no description');
    assert.equal(r.children[5].fields.quantity, 1);
    assert.equal(buildActor(r).plan.reconcile.attributes.essence, 5.7);
});

test('armor rows without a header', () => {
    for (const text of ['Berwick Suit 9 5 9 2,600¥', 'ARMOR\nBerwick Suit 9 5 9 2,600¥']) {
        const [r] = parseText(text).records;
        assert.equal(r.type, 'armor', text);
        assert.equal(r.name, 'Berwick Suit');
        assert.deepEqual([r.fields.armor, r.fields.capacity, r.fields.avail, r.fields.cost], ['9', '5', '9', '2,600¥']);
        const sys = buildItem({ type: 'armor', name: r.name, fields: r.fields }).data.system;
        assert.equal(sys.armor.value, 9);
        assert.equal(sys.technology.cost, 2600);
    }
});

test('quality formats', () => {
    const built = r => buildItem({ type: r.type, name: r.name, fields: r.fields, hint: r.hint }).data.system;
    const one = text => parseText(text).records.map(r => [r.type, r.name, String(r.fields.karma), built(r).type]);
    assert.deepEqual(one('Toughness (9 Karma)'), [['quality', 'Toughness', '9', 'positive']]);
    assert.deepEqual(one('Toughness: 9 Karma'), [['quality', 'Toughness', '9', 'positive']]);
    assert.deepEqual(one('TOUGHNESS COST: 9 KARMA'), [['quality', 'Toughness', '9', 'positive']]);
    assert.equal(one('ALLERGY\nBonus: 5 to 25 Karma\nYou react badly to something.')[0][3], 'negative');
    assert.deepEqual(one('POSITIVE QUALITIES\nToughness 9\nAmbidextrous 4').map(x => x.slice(0, 3)), [['quality', 'Toughness', '9'], ['quality', 'Ambidextrous', '4']]);
    assert.deepEqual(one('QUALITY KARMA\nToughness 9').map(x => x.slice(0, 3)), [['quality', 'Toughness', '9']]);
    const q = buildItem({ type: 'quality', name: 'Toughness', fields: { karma: '9' }, hint: { qualityType: 'positive' } }).data.system;
    assert.equal(q.karma, 9);
});

test('formatting guide examples parse as documented', async () => {
    const { FORMAT_GUIDE } = await import('../scripts/app/format-guide.js');
    const expected = {
        npc: ['character'], critter: ['character'], spirit: ['spirit'], sprite: ['sprite'],
        vehicle: ['vehicle', 'vehicle', 'vehicle'], weapon: ['weapon', 'weapon', 'weapon'], armor: ['armor', 'armor', 'armor'],
        ware: ['cyberware', 'cyberware', 'bioware'], gear: ['equipment', 'device'], host: ['host'], spell: ['spell'],
        adept: ['adept_power', 'adept_power'], quality: ['quality', 'quality', 'quality'], complex: ['complex_form'],
        critterpower: ['critter_power'], contact: ['contact'], json: ['character', 'weapon', 'quality'],
    };
    for (const g of FORMAT_GUIDE) {
        const res = g.id === 'json' ? parseJSON(g.example) : parseText(g.example);
        assert.deepEqual(res.records.map(r => r.type), expected[g.id], g.id);
        for (const r of res.records) assert.deepEqual(r.warnings ?? [], [], `${g.id}: ${r.name}`);
    }
});

test('hosts', () => {
    const text = `HOST: SAMPLE NOODLE BAR
Rating Attack Sleaze Data Proc. Firewall
3 3 4 5 6
Installed IC: Patrol IC, Tar Baby
Slaved Devices: Cameras, the till
Sculpting: A steaming
noodle stall.
Security Procedures: Patrol IC runs at all times. On an alert it
launches Tar Baby.
Pay Data: A list of regulars.`;
    for (const t of [text, `Sample template\n${text}`, text.replace('HOST: SAMPLE NOODLE BAR', 'Host: Sample Noodle Bar')]) {
        const hosts = parseText(t).records.filter(r => r.type === 'host');
        assert.equal(hosts.length, 1);
        const [r] = hosts;
        assert.equal(r.name, 'Sample Noodle Bar');
        assert.deepEqual([r.fields.rating, r.fields.attack, r.fields.sleaze, r.fields.data_processing, r.fields.firewall], ['3', '3', '4', '5', '6']);
        assert.deepEqual(r.fields.ic, ['Patrol IC', 'Tar Baby']);
        const sys = buildItem(r).data.system;
        assert.equal(sys.rating, 3);
        assert.equal(sys.customAttributes, true);
        assert.deepEqual(['att1', 'att2', 'att3', 'att4'].map(k => sys.atts[k].value), [3, 4, 5, 6]);
        assert.match(sys.description.value, /<strong>Sculpting:<\/strong> A steaming noodle stall\./);
        assert.match(sys.description.value, /<strong>Security Procedures:<\/strong> Patrol IC runs at all times\. On an alert it launches Tar Baby\./);
    }
    // A host printed among NPCs: both are read.
    const page = parseText(`${text}\n\nSAMPLE
BOUNCERS
(3, PROFESSIONAL RATING 2)
B A R S W L I C ESS
5 3 3 5 3 2 3 2 6
Initiative: 6 + 1D6
Condition Monitor: 11
Skills: Clubs 4, Intimidation 3, Throwing
Weapons 2, Unarmed Combat 4
Gear: Armor vest [12]
Weapons:
Club [Club, Reach 1, Acc 4, DV 7P, AP —]`).records;
    assert.deepEqual(page.map(r => [r.type, r.name]), [['host', 'Sample Noodle Bar'], ['character', 'Sample Bouncers']]);
    const npc = page[1];
    assert.equal(npc.fields.groupSize, 3);
    assert.equal(npc.fields.professionalRating, 2);
    assert.equal(npc.fields.description, undefined);
    assert.ok(npc.skills.some(s => s.name === 'Throwing Weapons' && s.rating === 2), 'a list line starting with "Weapons" continues the skills');
    assert.deepEqual(npc.children.map(c => [c.type, c.name]), [['armor', 'Armor vest'], ['weapon', 'Club']]);
});

test('pdf columns: two columns, side navigation, tables and page numbers', async () => {
    const { _internal } = await import('../scripts/app/pdf.js');
    const items = [];
    const put = (str, x, y, size = 9) => items.push({ str, transform: [size, 0, 0, size, x, y], width: str.length * size * 0.5, height: size });
    const prose = n => `Line ${n} of ordinary prose that fills most of a column`;
    let y = 750;
    put('HOST: SAMPLE NOODLE BAR', 30, y);
    ['Rating', 'Attack', 'Sleaze', 'Data Proc.', 'Firewall'].forEach((t, i) => put(t, 30 + i * 46, y - 12));
    ['3', '3', '4', '5', '6'].forEach((t, i) => put(t, 40 + i * 46, y - 24));
    for (let i = 0; i < 40; i++) put(`Left ${prose(i)}`, 30, y - 40 - i * 11);
    for (let i = 0; i < 44; i++) put(`Right ${prose(i)}`, 306, y + 2 - i * 11);
    ['INTRODUCTION', 'SCENE 1', 'SCENE 2', 'SCENE 3', 'LEGWORK', 'DEBRIEFING'].forEach((t, i) => put(t, 585, 730 - i * 60, 7));
    put('42', 300, 20, 7);
    const text = _internal.pageToText(items, 612, 'auto', 792);
    const lines = text.split('\n').filter(Boolean);
    assert.equal(lines[0], 'HOST: SAMPLE NOODLE BAR');
    assert.match(lines[1], /^Rating\s+Attack\s+Sleaze\s+Data Proc\.\s+Firewall$/);
    assert.equal(lines[3], `Left ${prose(0)}`);
    assert.equal(lines[42], `Left ${prose(39)}`);
    assert.equal(lines[43], `Right ${prose(0)}`);
    assert.equal(lines.length, 3 + 40 + 44, 'navigation tabs and the page number are left out');

    // A full-page table is not split into columns.
    const table = [];
    const cell = (str, x, y) => table.push({ str, transform: [9, 0, 0, 9, x, y], width: str.length * 4.5, height: 9 });
    ['HEAVY PISTOLS', 'ACC', 'DAMAGE', 'AP', 'MODE', 'AVAIL', 'COST'].forEach((t, i) => cell(t, [36, 200, 245, 300, 335, 470, 520][i], 740));
    for (let r = 0; r < 30; r++) ['Sample Pistol ' + r, '5(7)', '8P', '-1', 'SA', '5R', '725¥'].forEach((t, i) => cell(t, [36, 200, 245, 300, 335, 470, 520][i], 726 - r * 14));
    const rows = _internal.pageToText(table, 612, 'auto', 792).split('\n').filter(Boolean);
    assert.equal(rows.length, 31);
    assert.match(rows[1], /^Sample Pistol 0\s+5\(7\)\s+8P\s+-1\s+SA\s+5R\s+725¥$/);
});

test('adventure stat blocks: insect spirits, bound spirits, contact cards, headings', async () => {
    const { parseGroupLine } = await import('../scripts/parsers/statblock.js');
    assert.deepEqual(parseGroupLine('(FORCE 5 SOLDIER ANT SPIRITS, 3)'), { force: 5, spiritKind: 'SOLDIER ANT SPIRITS', groupSize: 3 });
    assert.deepEqual(parseGroupLine('(1, FORCE 7, BOUND, 3 SERVICES)'), { groupSize: 1, force: 7, bound: true, services: 3 });
    assert.deepEqual(parseGroupLine('(10)'), { groupSize: 10 });
    assert.equal(parseGroupLine('(Thermographic vision), Hive Mind'), null);

    const text = `Some story text about the van ride. The driver took the long way round through the
bikes.

HYBRID FORM
(FORCE 4 SOLDIER BEETLE SPIRITS, 2)
B A R S W L I C ESS EDG M
7 6 7(9) 6 4 4 4 4 4 2 4
Initiative: 9(11) + 2D6
Condition Monitor: 12
Limits: Physical 9, Mental 6, Social 6
Armor: 8
Skills: Assensing 4, Astral Combat 4, Unarmed Combat 4, Law Enforcement 3 (Professional Knowledge)
Powers: Fear, Hive Mind, Sapience, and Venom
Weaknesses: Allergy (insecticides, mild)
Unique Qualities: All beetle spirits can fly and have the Flight
skill and the Venom power.
Weapons:
Natural Weapon [unarmed, Acc 8, Reach —, DV 6P, AP –1]

Scene 4 (Optional): The Long Way
Scan This
The runners take a detour through the docks.

SPIRIT OF AIR
(1, FORCE 5, BOUND, 2 SERVICES)
B A R S W L I C ESS M
6 8 9 3 5 5 6 5 5 5
Initiative: 15 + 2D6
Skills: Assensing 5, Astral Combat 5, Perception 5

Cast of Shadows
Sample Fixer
A fixer who knows everyone in the sample sprawl and owes them all money.
B A R S W L I C ESS
3 3 3 2 4 5 5 6 6
Initiative: 8 + 1D6
Skills: Negotiation 6, Etiquette 5, Conjuring 2

A fixer who knows everyone in the sample sprawl and
owes them all money.

SAMPLE FIXER
Fixer
Male Human

Connection Rating: 3

Loyalty:

Key Active Skills: Negotiation, Etiq-
uette

Uses: Jobs, Gear

A fixer who knows everyone in the sample sprawl and
owes them all money.

SAMPLE FIXER
Fixer
Male Human

Connection Rating: 3

Loyalty:

Key Active Skills: Negotiation, Etiq-
uette

Uses: Jobs, Gear`;
    const { records } = parseText(text);
    assert.deepEqual(records.map(r => [r.documentName, r.type, r.name]), [
        ['Actor', 'spirit', 'Soldier Beetle Spirit (Hybrid Form)'],
        ['Actor', 'spirit', 'Spirit of Air'],
        ['Actor', 'character', 'Sample Fixer'],
        ['Item', 'contact', 'Sample Fixer'],
    ], 'one contact for the repeated handout card; "bikes." is not a BIKES heading');
    const [beetle, air, fixer, card] = records;
    assert.equal(beetle.fields.force, 4);
    assert.equal(beetle.fields.groupSize, 2);
    assert.equal(beetle.fields.spiritType, 'soldier');
    assert.equal(beetle.fields.initiative.meatspace.base, 11);
    assert.match(beetle.fields.notes, /^All beetle spirits can fly and have the Flight skill and the Venom power\.$/);
    assert.ok(beetle.children.some(c => c.name === 'Venom'));
    assert.deepEqual(beetle.children.filter(c => c.type === 'weapon').map(c => c.name), ['Natural Weapon'], 'the scene heading ends the block');
    const lk = beetle.skills.find(s => s.name === 'Law Enforcement');
    assert.equal(lk.category, 'knowledge');
    assert.equal(lk.knowledgeType, 'professional');
    assert.equal(air.fields.bound, true);
    assert.equal(air.fields.services, 2);
    assert.equal(buildActor(air).data.system.services, 2);
    assert.deepEqual(fixer.skills.filter(s => s.fromGroup).map(s => s.name), ['Banishing', 'Binding', 'Summoning'], 'Conjuring is a skill group');
    assert.equal(card.fields.connection, '3');
    assert.equal(card.fields.type, 'Fixer');
    const sys = buildItem(card).data.system;
    assert.equal(sys.connection, 3);
    assert.equal(sys.type, 'Fixer');
    assert.match(sys.description.value, /<strong>Key Active Skills:<\/strong> Negotiation, Etiquette/);
});

test('pdf: running footers next to the last line of a column', async () => {
    const { _internal } = await import('../scripts/app/pdf.js');
    const items = [];
    const put = (str, x, y, size = 9) => items.push({ str, transform: [size, 0, 0, size, x, y], width: str.length * size * 0.45, height: size });
    for (let i = 0; i < 60; i++) put(`Left column line ${i} with ordinary words in it`, 30, 720 - i * 11.5);
    for (let i = 0; i < 40; i++) put(`Right column line ${i} with ordinary words in it`, 300, 740 - i * 11.5);
    put('SCENE 3: A LONG RUNNING FOOTER TITLE', 120, 39, 12);   // crosses the gutter, right beside the last left line
    put('13', 560, 40, 14);
    // A value printed as its own run at the very top of a column is not a page number.
    put('Condition Monitor:', 300, 752);
    put('12', 380, 752);
    const lines = _internal.pageToText(items, 612, 'auto', 792).split('\n').filter(Boolean);
    assert.equal(lines[59], 'Left column line 59 with ordinary words in it');
    assert.equal(lines[60], 'Condition Monitor: 12');
    assert.equal(lines[61], 'Right column line 0 with ordinary words in it');
    assert.ok(!lines.some(l => /SCENE 3|^13$/.test(l)));
});

test('pdf: fonts without a character map are decoded', async () => {
    const { decodePdfText } = await import('../scripts/app/pdf-decode.js');
    // Glyph numbers = characters shifted by 28; ’ – “ ” are glyphs outside that range.
    const glyph = { '’': 118, '–': 122, '“': 119, '”': 120 };
    const enc = s => [...s].map(ch => String.fromCharCode(glyph[ch] ?? ch.charCodeAt(0) - 28)).join('');
    const prose = 'The runner’s team took the job. They didn’t ask about the pay, and the fixer said “Go now.” to them. ';
    const items = [
        ...Array.from({ length: 6 }, () => ({ str: enc(prose), fontName: 'body' })),
        { str: enc('Weapons Ares Predator V [Heavy Pistol, Acc 5(7), DV 8P, AP –1, SA, RC –, 15(c)]'), fontName: 'body' },
        { str: enc('SAMPLE GUARD'), fontName: 'heading' },
        { str: 'Plain text in a normal font.', fontName: 'normal' },
    ];
    const res = decodePdfText([items]);
    assert.equal(res.decoded, true);
    assert.equal(items[0].str, prose);
    assert.match(items[6].str, /AP –1, SA/);
    assert.equal(items[7].str, 'SAMPLE GUARD', 'small heading fonts use the document shift');
    assert.equal(items[8].str, 'Plain text in a normal font.', 'normal fonts are left alone');
    // Nothing to decode in an ordinary PDF.
    const normal = [{ str: 'An ordinary page of text with ordinary words in it.', fontName: 'a' }];
    assert.equal(decodePdfText([normal]).decoded, false);
});

test('label-table stat blocks (labels without colons)', () => {
    const text = `PEOPLE
SAMPLE ENFORCER
Sample Enforcer keeps order in the market and settles disputes with his fists,
his wits, or his very large friends. Nobody remembers him smiling.
MALE ORK
B  A  R  S  W  L  I  C  ESS
6 (+2)  4  4 (6)  5  3  2  3  2  3.2
Condition   11/10
Monitor
Armor  12
Physical   8(10) + 2(3)D6
Initiative
Skills  Clubs 5, Intimidation (6)*, Pistols [8], Unarmed Combat 6 (Boxing w/
Clinch [Hold] and Jab techniques +2)
Knowledge   Market Gossip 4,
Skills  Local Gangs 3
Gear  Armor jacket [12], earbuds [Rating 2, w/ audio enhancement 3,
fake SIN [Rating 4], jammer (area,
Rating 4)
Weapons  Ares Predator V [Heavy Pistol, Acc 5, DV 8P, AP  1, SA, 15(c))
Target hit is knocked back a step and loses its footing.
Notes  He never fights fair.
* Gamemasters can swap his pistol for a shotgun if they like.

SAMPLE SLUDGE SPIRIT
(RATING 5)
B  A  R  S  W  L  I  C  EDG ESS M
7  4  5  6  5  4  4  4  2  5  5
Initiative  9 + 2D6
Skills  Assensing, Perception`;
    const { records } = parseText(text);
    assert.deepEqual(records.map(r => [r.type, r.name]), [['character', 'Sample Enforcer'], ['spirit', 'Sample Sludge Spirit']]);
    const [e, spirit] = records;
    const a = e.fields.attributes;
    assert.deepEqual([a.body.base, a.body.augmented, a.reaction.augmented, a.essence.base], [6, 8, 6, 3.2]);
    assert.equal(e.fields.metatype, 'ork');
    assert.deepEqual([e.fields.condition.physical, e.fields.condition.stun], [11, 10]);
    assert.deepEqual(e.fields.initiative.meatspace, { base: 10, dice: 3 });
    assert.match(e.fields.description, /^Sample Enforcer keeps order/);
    const sk = Object.fromEntries(e.skills.map(s => [s.name, s]));
    assert.equal(sk.Intimidation.rating, 6);
    assert.equal(sk['Unarmed Combat'].rating, 6);
    assert.equal(sk['Market Gossip'].category, 'knowledge');
    assert.equal(sk['Local Gangs'].category, 'knowledge');
    const items = e.children.map(c => c.name);
    assert.ok(items.includes('Fake SIN') || items.includes('fake SIN'), 'a missing "]" is repaired');
    assert.ok(items.some(n => /^Jammer/i.test(n)), 'a line inside open brackets carries on the item');
    const gun = e.children.find(c => c.type === 'weapon');
    assert.equal(gun.fields.ap, '-1', 'an unsigned AP lost its minus');
    assert.match(e.fields.notes, /knocked back/);
    assert.match(e.fields.notes, /never fights fair/);
    assert.match(e.fields.notes, /swap his pistol/);
    assert.equal(spirit.fields.force, 5, '(RATING 5) is a spirit\'s Force');
});

test('adventure names with role lines, per-runner counts and book misprints', () => {
    const text = `SAMPLE CORPORAL
AND JANE ROE
HUMAN UCAS MARINES
(2, PROFESSIONAL RATING 5)
B  A  R  S  W  L  I  C  ESS
5  4  4  4  3  3  4  3  6
Initiative: 8 + 1D6
Skills: Pistols 5
Gear: Heavy armor with helmet [w/ chemseal] Hermes Ikon commlink [Device Rating 3]
Weapons:
HK 227 [Submachine Gun, Acc 5(7), DV 7P, AP –1, SA/BF/FA, RC 1, 28(c)]

DAVE, ELVEN
TOXIC SHAMAN
(1 PER RUNNER) (PROFESSIONAL RATING 2)
B  A  R  S  W  L  I  C  ESS ESS
3  4  4  3  4  4  4  3  2  6
Initiative: 8 + 1D6
Skills: Spellcasting 4
Qualities: Magician
(Gear: Armor jacket, reagents (15 drams), commlink [Device
Rating 3]
Augmentations: [all betaware] Bone density 2, Orthoskin
Rating 4, Pain editor

Sergeant
Sam Sample
Dwarven U.C.A.S. Marine Pilot
Sam has flown everything with rotors and most things without.
B  A  R  S  W  L  I  C  ESS
4  3  5  3  4  5  2  2  6
Initiative: 7 + 1D6

UCAS MCT-NISSAN
ROTO-DRONE (2)
HANDL SPEED ACCEL BODY ARMOR PILOT SENSOR SEATS
4  4  2  4  4  3  3  0`;
    const { records } = parseText(text);
    assert.deepEqual(records.map(r => r.name), ['Sample Corporal and Jane Roe', 'Dave', 'Sergeant Sam Sample', 'UCAS MCT-Nissan Roto-Drone']);
    const [a, b, c, d] = records;
    assert.deepEqual([a.fields.role, a.fields.metatype, a.fields.groupSize], ['HUMAN UCAS MARINES', 'human', 2]);
    assert.deepEqual(a.children.map(x => x.name), ['Heavy armor with helmet', 'Hermes Ikon commlink', 'HK 227']);
    assert.deepEqual([b.fields.role, b.fields.metatype, b.fields.perRunner, b.fields.professionalRating], ['ELVEN TOXIC SHAMAN', 'elf', '1 per runner', 2]);
    assert.equal(b.fields.attributes.edge.base, 2, 'the first of two ESS columns is Edge');
    assert.ok(b.children.some(x => x.name === 'Armor jacket'), '"(Gear:" is read as Gear');
    const ware = b.children.filter(x => x.type === 'bioware' || x.type === 'cyberware');
    assert.deepEqual(ware.map(x => [x.name, x.fields.rating, x.fields.grade]), [['Bone density', 2, 'betaware'], ['Orthoskin', 4, 'betaware'], ['Pain editor', undefined, 'betaware']]);
    assert.deepEqual([c.fields.role, c.fields.metatype], ['Dwarven U.C.A.S. Marine Pilot', 'dwarf']);
    assert.match(c.fields.description, /^Sam has flown/);
    assert.deepEqual([d.type, d.fields.groupSize, d.fields.vehicle.vehicleType], ['vehicle', 2, 'air']);
});

test('an NPC printed twice with typos imports once, merged', () => {
    const block = (extra, gear) => `SAMPLE PILOT
DWARF SAMPLE MARINE PILOT
${extra}
B  A  R  S  W  L  I  C  EDG ESS
4  3  5(7)  3  4  5  2  2  2  3.2
Initiative: 7 + 1D6
Skills: Gunnery 5, Pilot Aircraft 6${gear}`;
    const text = `${block('(2 PER RUNNER)', '\nGear: Full body armor, helmet')}

Something happens in between, told over a few lines of story text so the two copies are apart.

${block('A quiet pilot who has flown everywhere and seen most of it from above.', ', Perception 3\nGear: Full body armor and helmet, commlink [Device Rating 4]')}

SAMPLE GUARD
B  A  R  S  W  L  I  C  ESS
4  3  5  3  4  5  2  2  6
Initiative: 7 + 1D6`;
    const { records } = parseText(text);
    assert.deepEqual(records.map(r => r.name), ['Sample Pilot', 'Sample Guard']);
    const [p] = records;
    assert.match(p.fields.description, /^A quiet pilot/);
    assert.equal(p.fields.perRunner, '2 per runner');
    assert.deepEqual(p.skills.map(s => s.name), ['Gunnery', 'Pilot Aircraft', 'Perception']);
    assert.ok(p.children.some(c => /commlink/i.test(c.name)) && p.children.filter(c => /armor/i.test(c.name)).length === 1);
    assert.ok(p.warnings.some(w => /merged/.test(w)));
});
