# RFC 0039: Test Data Generator

## Summary
A comprehensive test data generation system that creates realistic, framework-aware test data with support for multiple data types and export formats.

## Motivation
We need automated test data generation for:
1. E2E test fixtures
2. Unit test mocks
3. Database seeding
4. API testing payloads
5. Framework-specific data structures

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Test Data Generator                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   Generator │  │   Faker      │  │   Exporter   │             │
│  │   Engine    │  │   Adapters   │  │              │             │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   Schema     │  │   Factory    │  │   Seed       │             │
│  │   Validator  │  │   Registry   │  │   Manager    │             │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Generator Types
```typescript
interface TestDataConfig {
  framework?: FrameworkType;         // For framework-specific generation
  seed?: number;                   // Random seed for reproducibility
  locale?: string;                // Faker locale
  count?: number;                 // Default count for bulk generation
}

interface DataSchema {
  id: string;
  name: string;
  type: DataType;
  fields: FieldDefinition[];
  constraints?: Constraint[];
}

type DataType = 
  | 'user' | 'product' | 'order' | 'document'
  | 'api_request' | 'api_response'
  | 'database_record' | 'file'
  | 'custom';

interface FieldDefinition {
  name: string;
  type: FieldType;
  faker?: string;                  // Faker method name
  generator?: CustomGenerator;      // Custom generator function
  options?: FieldOptions;
  default?: unknown;
  required?: boolean;
  unique?: boolean;
  validate?: ValidationRule;
}

type FieldType = 
  | 'string' | 'number' | 'boolean' 
  | 'date' | 'datetime' | 'uuid'
  | 'email' | 'phone' | 'url'
  | 'address' | 'name' | 'text'
  | 'image' | 'file'
  | 'json' | 'array' | 'object'
  | 'foreign_key' | 'enum'
  | 'custom';

interface FieldOptions {
  min?: number;
  max?: number;
  pattern?: RegExp;
  format?: string;                  // Date format, etc.
  prefix?: string;
  suffix?: string;
  choices?: unknown[];              // For enum
  ref?: string;                    // Reference to another schema
}

// Example schema
const userSchema: DataSchema = {
  id: 'user',
  name: 'User',
  type: 'user',
  fields: [
    { name: 'id', type: 'uuid', required: true },
    { name: 'email', type: 'email', unique: true },
    { name: 'name', type: 'name' },
    { name: 'age', type: 'number', options: { min: 18, max: 100 } },
    { name: 'created_at', type: 'datetime' },
    { name: 'role', type: 'enum', options: { choices: ['admin', 'user', 'guest'] } }
  ]
};
```

### 2. Generator Engine
```typescript
class TestDataGenerator {
  constructor(config: TestDataConfig);
  
  // Schema management
  registerSchema(schema: DataSchema): void;
  getSchema(id: string): DataSchema | null;
  listSchemas(): DataSchema[];
  
  // Generation
  generate(schemaId: string, count?: number): GeneratedData[];
  generateOne(schemaId: string): GeneratedData;
  
  // Async generation for large datasets
  async generateAsync(schemaId: string, count: number): Promise<GeneratedData[]>;
  
  // Custom generators
  registerGenerator(type: string, generator: CustomGenerator): void;
  
  // Export
  export(data: GeneratedData[], format: ExportFormat): string;
  exportToFile(data: GeneratedData[], format: ExportFormat, path: string): Promise<void>;
}

interface GeneratedData {
  schemaId: string;
  id: string;
  data: Record<string, unknown>;
  _meta: {
    generatedAt: string;
    seed: number;
    sequence: number;
  };
}

type ExportFormat = 
  | 'json' | 'jsonl'
  | 'csv' | 'tsv'
  | 'yaml' | 'yml'
  | 'sql' | 'sql-insert' | 'sql-update'
  | 'fixture'          // Django fixture
  | 'factory'          // Laravel factory
  | 'factory-bot'      // Ruby FactoryBot
  | 'factory-girl'     // Python Factory Boy
  | 'faker-js';        // JavaScript faker format
```

### 3. Framework Adapters
```typescript
interface FrameworkAdapter {
  readonly framework: FrameworkType;
  readonly supportedFormats: ExportFormat[];
  
  generateSeedData(schema: DataSchema, options?: SeedOptions): GeneratedData[];
  exportFixtures(data: GeneratedData[], type: FixtureType): string;
  generateFactory(data: GeneratedData[], type: FactoryType): string;
}

interface SeedOptions {
  count?: number;
  relations?: RelationConfig[];
  cleanup?: boolean;
}

// Frappe/ERPNext adapter
class FrappeAdapter implements FrameworkAdapter {
  readonly framework = 'frappe_erpnext';
  readonly supportedFormats = ['json', 'jsonl', 'sql'];
  
  generateSeedData(schema: DataSchema): GeneratedData[] {
    // Generate data in Frappe format
    return this.generate(schema.id, 10).map(d => ({
      ...d,
      data: {
        doctype: schema.name,
        ...d.data
      }
    }));
  }
  
  exportFixtures(data: GeneratedData[]): string {
    // Export as Frappe fixtures
    return JSON.stringify(data.map(d => d.data), null, 2);
  }
}

// Next.js/React adapter
class NextjsAdapter implements FrameworkAdapter {
  readonly framework = 'nextjs';
  readonly supportedFormats = ['json', 'faker-js', 'factory'];
  
  generateSeedData(schema: DataSchema): GeneratedData[] {
    // Generate data in Next.js compatible format
  }
}

// Django adapter
class DjangoAdapter implements FrameworkAdapter {
  readonly framework = 'django';
  readonly supportedFormats = ['json', 'fixture', 'factory-boy', 'sql'];
  
  exportFixtures(data: GeneratedData[]): string {
    return JSON.stringify({
      pk: data[0]?.data.id,
      model: `app.${schema.name.toLowerCase()}`,
      fields: data[0]?.data
    }, null, 2);
  }
}
```

### 4. Factory System
```typescript
interface FactoryDefinition {
  name: string;
  schemaId: string;
  defaults?: Record<string, unknown>;
  sequences?: SequenceDefinition[];
  afterCreate?: PostProcessHook;
}

interface SequenceDefinition {
  field: string;
  type: 'increment' | 'uuid' | 'random';
  start?: number;
}

type PostProcessHook = (data: Record<string, unknown>) => Record<string, unknown>;

class FactoryRegistry {
  constructor(generator: TestDataGenerator);
  
  register(factory: FactoryDefinition): void;
  getFactory(name: string): FactoryDefinition | null;
  
  // Factory methods
  create<T = Record<string, unknown>>(
    factoryName: string, 
    overrides?: Partial<T>
  ): T;
  
  createMany<T = Record<string, unknown>>(
    factoryName: string, 
    count: number, 
    overrides?: Partial<T>
  ): T[];
  
  make<T = Record<string, unknown>>(
    factoryName: string, 
    overrides?: Partial<T>
  ): T;  // Same as create but don't persist
  
  build<T = Record<string, unknown>>(
    factoryName: string, 
    overrides?: Partial<T>
  ): T;  // Alias for make
}

// Example factory
registry.register({
  name: 'UserFactory',
  schemaId: 'user',
  defaults: {
    role: 'user',
    verified: false
  },
  sequences: [
    { field: 'email', type: 'increment', start: 1 }
  ],
  afterCreate: (data) => ({
    ...data,
    created_at: new Date().toISOString(),
    slug: generateSlug(data.name as string)
  })
});

// Usage
const user = factory.create('UserFactory', { role: 'admin' });
const users = factory.createMany('UserFactory', 10);
```

### 5. Relation Handler
```typescript
interface RelationConfig {
  from: string;                    // Schema ID
  to: string;                     // Schema ID
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
  field: string;                  // Foreign key field
  count?: number;                 // For one-to-many
}

class RelationHandler {
  constructor(generator: TestDataGenerator);
  
  setRelations(relations: RelationConfig[]): void;
  
  // Generate with relations
  generateWithRelations(
    schemaId: string, 
    count: number
  ): GeneratedData[];
  
  // Ensure referential integrity
  resolveReferences(data: GeneratedData[]): GeneratedData[];
}

// Example relations
relationHandler.setRelations([
  { from: 'order', to: 'user', type: 'many-to-one', field: 'user_id' },
  { from: 'order_item', to: 'order', type: 'many-to-one', field: 'order_id' },
  { from: 'order_item', to: 'product', type: 'many-to-one', field: 'product_id' }
]);

// Generate orders with related users and items
const orders = relationHandler.generateWithRelations('order', 10);
```

## File Structure
```
packages/test-data-generator/
├── src/
│   ├── index.ts                    # Public exports
│   ├── generator.ts               # TestDataGenerator class
│   ├── schema/
│   │   ├── validator.ts           # Schema validation
│   │   └── parser.ts              # Schema parsing
│   ├── faker/
│   │   ├── faker-adapter.ts       # Faker.js integration
│   │   ├── generators.ts          # Built-in generators
│   │   └── custom.ts             # Custom generators
│   ├── factories/
│   │   ├── registry.ts            # FactoryRegistry
│   │   └── builder.ts             # Factory builder
│   ├── relations/
│   │   ├── handler.ts             # RelationHandler
│   │   └── integrity.ts           # Referential integrity
│   ├── exporters/
│   │   ├── json.ts
│   │   ├── csv.ts
│   │   ├── sql.ts
│   │   ├── yaml.ts
│   │   └── fixtures/              # Framework-specific fixtures
│   │       ├── django.ts
│   │       ├── laravel.ts
│   │       └── factory-bot.ts
│   ├── adapters/
│   │   ├── index.ts               # Framework adapters
│   │   ├── frappe.ts
│   │   ├── nextjs.ts
│   │   ├── django.ts
│   │   └── laravel.ts
│   ├── types.ts
│   └── errors.ts
├── schemas/
│   ├── user.json
│   ├── product.json
│   ├── order.json
│   └── common.json
├── test/
├── examples/
│   ├── basic-generation.ts
│   ├── factory-pattern.ts
│   ├── relations.ts
│   └── exporters.ts
├── package.json
└── README.md
```

## Usage Examples

### Basic Generation
```typescript
import { TestDataGenerator } from '@pi/test-data-generator';

const generator = new TestDataGenerator({
  seed: 12345,  // Reproducible
  locale: 'en_US'
});

// Generate users
const users = generator.generate('user', 10);
console.log(users[0].data);

// Export to JSON
const json = generator.export(users, 'json');
```

### Schema Definition
```typescript
import { FieldType } from '@pi/test-data-generator';

const productSchema: DataSchema = {
  id: 'product',
  name: 'Product',
  type: 'product',
  fields: [
    { name: 'id', type: 'uuid', required: true },
    { name: 'name', type: 'text', faker: 'commerce.productName' },
    { name: 'price', type: 'number', options: { min: 1, max: 1000 } },
    { name: 'sku', type: 'string', faker: 'commerce.product' },
    { name: 'category', type: 'enum', options: { choices: ['Electronics', 'Clothing', 'Books'] } },
    { name: 'in_stock', type: 'boolean', faker: 'datatype.boolean' },
    { name: 'created_at', type: 'datetime' }
  ]
};

generator.registerSchema(productSchema);
const products = generator.generate('product', 20);
```

### Factory Pattern
```typescript
import { FactoryRegistry } from '@pi/test-data-generator';

const factory = new FactoryRegistry(generator);

factory.register({
  name: 'TestUser',
  schemaId: 'user',
  defaults: {
    role: 'test_user',
    verified: true,
    email: 'test@example.com'  // Will be overridden in sequence
  },
  afterCreate: (data) => ({
    ...data,
    test_id: `test_${Date.now()}`
  })
});

// Create test data
const testUsers = factory.createMany('TestUser', 5, {
  name: 'Test User'
});
```

### Export to SQL
```typescript
// Generate SQL INSERT statements
const sql = generator.export(users, 'sql-insert');

// Output:
// INSERT INTO users (id, email, name, age, created_at) VALUES 
// ('uuid-1', 'user1@example.com', 'John Doe', 30, '2024-01-01T00:00:00Z'),
// ('uuid-2', 'user2@example.com', 'Jane Doe', 25, '2024-01-01T00:00:00Z');
```

### Framework-Specific: Frappe
```typescript
import { TestDataGenerator } from '@pi/test-data-generator';
import { FrappeAdapter } from '@pi/test-data-generator/adapters/frappe';

const generator = new TestDataGenerator({
  framework: 'frappe_erpnext'
});

generator.registerSchema(frappeDoctypeSchema);

// Generate in Frappe format
const frappeData = generator.generate('Customer', 10);

// Export as fixture
const fixture = generator.export(frappeData, 'json');
// Result: { doctype: 'Customer', values: [...] }
```

### Relations
```typescript
import { RelationHandler } from '@pi/test-data-generator';

const handler = new RelationHandler(generator);

handler.setRelations([
  { from: 'blog_post', to: 'author', type: 'many-to-one', field: 'author_id' },
  { from: 'blog_post', to: 'tag', type: 'many-to-many', field: 'tag_ids' }
]);

// Generate blog posts with related authors and tags
const posts = handler.generateWithRelations('blog_post', 20);

// All authors and tags are also generated
```

## Acceptance Criteria
1. ✅ Faker.js-based data generation with locale support
2. ✅ Custom schema definition and validation
3. ✅ Factory pattern for test data reuse
4. ✅ Multiple export formats (JSON, CSV, SQL, fixtures)
5. ✅ Framework-specific adapters (Frappe, Django, Laravel)
6. ✅ Relation handling with referential integrity
7. ✅ Reproducible generation with seed support

## Dependencies
- `packages/types` - for runtime-types
- `@faker-js/faker` - data generation
- `yaml` - YAML export
- `csv-stringify` - CSV export
- No framework-specific dependencies
