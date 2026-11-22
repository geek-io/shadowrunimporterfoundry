// Minimal stand-ins for foundry.data.fields that record the schema shape.
class DataField { constructor(opts = {}) { this.options = opts; this.kind = this.constructor.name; } }
class StringField extends DataField {}
class NumberField extends DataField {}
class BooleanField extends DataField {}
class HTMLField extends StringField {}
class DocumentUUIDField extends StringField {}
class AnyField extends DataField {}
class ObjectField extends DataField {}
class SchemaField extends DataField { constructor(fields, opts = {}) { super(opts); this.fields = fields; } }
class ArrayField extends DataField { constructor(element, opts = {}) { super(opts); this.element = element; } }
class TypedObjectField extends DataField { constructor(element, opts = {}) { super(opts); this.element = element; } }
class TypeDataModel { static defineSchema() { return {}; } }
globalThis.foundry = { data: { fields: { DataField, StringField, NumberField, BooleanField, HTMLField, DocumentUUIDField, AnyField, ObjectField, SchemaField, ArrayField, TypedObjectField } }, abstract: { TypeDataModel } };
globalThis.CONFIG = { ChatMessage: { modes: { public: 'Public', gm: 'GM', blind: 'Blind', self: 'Self' } } };
const origLog = console.log; console.log = (...a) => { if (typeof a[0] === 'string' && /Data:?$/.test(a[0])) return; origLog(...a); };
