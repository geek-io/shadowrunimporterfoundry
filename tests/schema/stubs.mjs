// Replacement sources for system files the schema check doesn't need in full.
export const STUBS = {
    'utils/timeUnits.ts': "export const INTERVAL_UNITS = ['rounds', 'seconds', 'minutes', 'hours', 'days', 'weeks', 'months'];\n",
    'types/fields/ModifiableField.ts': 'export class ModifiableField extends foundry.data.fields.SchemaField { constructor(fields: any, opts?: any) { super(fields, opts); } }\n',
    'types/fields/TagifyMultiField.ts': 'export class TagifyMultiField extends foundry.data.fields.ArrayField { constructor(choices?: any) { super(new foundry.data.fields.StringField({ choices, required: true })); } }\n',
    'types/fields/TagifySelectField.ts': 'export class TagifySelectField extends foundry.data.fields.StringField { constructor(opts?: any) { super(opts); } }\n',
};
