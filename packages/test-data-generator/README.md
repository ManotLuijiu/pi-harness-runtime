# @pi/test-data-generator

Generate realistic test data with schema definitions, fixtures, and multiple export formats.

## Features

- **Schema-Based Generation** - Define data schemas with field types and options
- **50+ Field Types** - Pre-built generators for names, addresses, emails, etc.
- **Custom Generators** - Add your own field generators
- **Bulk Generation** - Generate thousands of records at once
- **Seed Support** - Reproducible data with seeded random
- **Relationships** - Define relations between schemas
- **Hooks** - Pre/post generation hooks for data transformation
- **Multiple Export Formats** - JSON, CSV, SQL, YAML, and fixtures
- **TypeScript Support** - Full type definitions

## Installation

```bash
npm install @pi/test-data-generator
```

## Quick Start

### Basic Usage

```typescript
import { createTestDataGenerator } from "@pi/test-data-generator";

const generator = createTestDataGenerator({
  seed: 12345, // For reproducibility
});

// Generate users
const result = await generator.generate({
  schema: {
    name: "User",
    fields: [
      { name: "email", type: "email" },
      { name: "firstName", type: "firstName" },
      { name: "lastName", type: "lastName" },
      { name: "age", type: "number", options: { min: 18, max: 99 } },
      { name: "isActive", type: "boolean" },
      { name: "createdAt", type: "datetime", options: { past: true } },
    ],
  },
  count: 10,
});

console.log(result.records[0].data);
// {
//   email: "john.smith@example.com",
//   firstName: "John",
//   lastName: "Smith",
//   age: 42,
//   isActive: true,
//   createdAt: "2024-01-15T10:30:00.000Z"
// }
```

### Field Types

```typescript
// Basic types
{ name: "name", type: "string" }
{ name: "count", type: "number", options: { min: 1, max: 100 } }
{ name: "active", type: "boolean" }

// Identity
{ name: "email", type: "email" }
{ name: "phone", type: "phone" }
{ name: "uuid", type: "uuid" }
{ name: "userName", type: "userName" }
{ name: "password", type: "password", options: { minLength: 16 } }

// Person
{ name: "firstName", type: "firstName" }
{ name: "lastName", type: "lastName" }
{ name: "fullName", type: "fullName" }
{ name: "avatar", type: "avatar" }

// Location
{ name: "address", type: "address" }
{ name: "city", type: "city" }
{ name: "country", type: "country" }
{ name: "zipCode", type: "zipCode" }

// Company
{ name: "company", type: "company" }
{ name: "department", type: "department" }
{ name: "jobTitle", type: "jobTitle" }

// Text
{ name: "bio", type: "paragraph" }
{ name: "headline", type: "sentence" }
{ name: "tag", type: "word" }

// Network
{ name: "website", type: "url" }
{ name: "ip", type: "ipv4" }

// Financial
{ name: "card", type: "creditCard" }
{ name: "currency", type: "currency" }

// Enum
{ name: "status", type: "enum", options: { values: ["pending", "active", "closed"] } }

// Array
{ name: "tags", type: "array", options: { itemType: "word", maxItems: 5 } }
```

### Field Options

```typescript
// String options
{ name: "code", type: "string", options: { minLength: 8, maxLength: 16, uppercase: true } }

// Number options
{ name: "score", type: "number", options: { min: 0, max: 100, integer: true } }

// Date options
{ name: "created", type: "date", options: { past: true } }
{ name: "expires", type: "date", options: { future: true } }
{ name: "birthDate", type: "date", options: { maxDate: "2005-01-01" } }

// Enum with weights
{ name: "role", type: "enum", options: {
  values: ["admin", "user", "guest"],
  weights: [0.1, 0.7, 0.2]  // 10% admin, 70% user, 20% guest
}}
```

### Schema Registration

```typescript
const generator = createTestDataGenerator();

// Register schema
generator.registerSchema({
  name: "Product",
  fields: [
    { name: "name", type: "string" },
    { name: "price", type: "number", options: { min: 1, max: 1000 } },
    { name: "sku", type: "uuid" },
    { name: "inStock", type: "boolean" },
  ],
});

// Use by name
const products = await generator.generate({
  schemaId: "Product",
  count: 100,
});
```

### Hooks

```typescript
const schema = {
  name: "Order",
  fields: [
    { name: "id", type: "uuid" },
    { name: "total", type: "number" },
    { name: "status", type: "enum", options: { values: ["pending", "completed"] } },
  ],
  hooks: {
    beforeCreate: (data) => ({
      ...data,
      createdAt: new Date().toISOString(),
    }),
    afterCreate: (data) => ({
      ...data,
      reference: `ORD-${data.id.slice(0, 8)}`,
    }),
  },
};
```

### Data Overrides

```typescript
// Generate with specific values
const result = await generator.generate({
  schema,
  count: 5,
  data: {
    isAdmin: true,  // Override all records
  },
});

// Per-record overrides
const result = await generator.generate({
  schema,
  count: 3,
  data: [
    { email: "admin@example.com" },    // Record 0
    { email: "user1@example.com" },    // Record 1
    { email: "user2@example.com" },    // Record 2
  ],
});
```

### Export Formats

```typescript
import { exportToJson, exportToCsv, exportToSql } from "@pi/test-data-generator";

// Export as JSON
const json = exportToJson(result.records, { pretty: true });

// Export as CSV
const csv = exportToCsv(result.records, ["email", "name", "age"]);

// Export as SQL INSERT statements
const sql = exportToSql(result.records, "users");
```

### Seeding

```typescript
// Same seed = same data
const gen1 = createTestDataGenerator({ seed: 12345 });
const gen2 = createTestDataGenerator({ seed: 12345 });

const result1 = await gen1.generate({ schema, count: 10 });
const result2 = await gen2.generate({ schema, count: 10 });

console.log(result1.records[0].data.email === result2.records[0].data.email); // true
```

## API Reference

### TestDataGenerator

```typescript
const generator = createTestDataGenerator({
  seed?: number;          // Random seed
  locale?: string;        // Data locale (default: "en")
  verbose?: boolean;       // Enable logging
  maxRetries?: number;    // Max generation attempts
  customGenerators?: Record<string, CustomGenerator>;
});
```

### Methods

```typescript
// Register schema
generator.registerSchema(schema: Schema): void;

// Get registered schema
generator.getSchema(name: string): Schema | undefined;

// Generate data
generator.generate(request: GenerationRequest): Promise<GenerationResult>;

// Get faker instance
generator.getFaker(): SimpleFaker;

// Set seed
generator.setSeed(seed: number): void;

// Register custom generator
generator.registerCustomGenerator(name: string, generator: CustomGenerator): void;
```

### Schema

```typescript
interface Schema {
  name: string;
  fields: FieldDefinition[];
  relations?: RelationDefinition[];
  hooks?: SchemaHooks;
}
```

### FieldDefinition

```typescript
interface FieldDefinition {
  name: string;
  type: FieldType;
  options?: FieldOptions;
  required?: boolean;
  default?: unknown;
  validate?: FieldValidator;
}
```

### GenerationResult

```typescript
interface GenerationResult {
  success: boolean;
  records: GeneratedRecord[];
  count: number;
  generationTimeMs: number;
  errors?: GenerationError[];
}
```

## Field Types Reference

| Type | Description | Example |
| ------ | ------------- | --------- |
| `string` | Random string | "xK9mP2nL" |
| `number` | Random number | 42 |
| `boolean` | Random boolean | true |
| `date` | Random date | "2024-01-15T10:30:00Z" |
| `email` | Email address | "<john@example.com>" |
| `url` | URL | "<https://example.com>" |
| `phone` | Phone number | "(555) 123-4567" |
| `uuid` | UUID v4 | "550e8400-e29b-41d4-a716-446655440000" |
| `firstName` | First name | "John" |
| `lastName` | Last name | "Smith" |
| `fullName` | Full name | "John Smith" |
| `address` | Street address | "123 Main St" |
| `city` | City | "New York" |
| `country` | Country | "United States" |
| `zipCode` | Zip code | "10001" |
| `company` | Company name | "Acme Corp" |
| `department` | Department | "Engineering" |
| `jobTitle` | Job title | "Software Engineer" |
| `paragraph` | Paragraph | "Lorem ipsum dolor sit amet..." |
| `sentence` | Sentence | "Lorem ipsum dolor." |
| `word` | Single word | "lorem" |
| `image` | Image URL | "<https://picsum.photos/640/480>" |
| `avatar` | Avatar URL | "<https://api.dicebear.com/>..." |
| `color` | Color name | "blue" |
| `hexColor` | Hex color | "#3498db" |
| `ipv4` | IPv4 address | "192.168.1.1" |
| `ipv6` | IPv6 address | "2001:0db8:..." |
| `userName` | Username | "johnsmith42" |
| `password` | Password | "xK9mP2nL4..." |
| `creditCard` | Credit card | "4111234567890123" |
| `currency` | Currency code | "USD" |
| `fileName` | File name | "document.pdf" |
| `filePath` | File path | "/home/user/docs/file.txt" |
| `mimeType` | MIME type | "application/json" |
| `latitude` | Latitude | 40.7128 |
| `longitude` | Longitude | -74.0060 |
| `enum` | Enum value | "active" |
| `array` | Array of values | ["tag1", "tag2"] |
| `object` | Nested object | { name: "John" } |
| `custom` | Custom generator | custom function |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                 TestDataGenerator                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │   Schema   │  │   Faker    │  │   Generator    │  │
│  │   Manager  │──│   Adapter  │──│   Engine      │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
│         │                                       │        │
│         ▼                                       ▼        │
│  ┌─────────────┐                       ┌─────────────────┐│
│  │   Field    │                       │  Generation    ││
│  │  Validators│                       │  Results       ││
│  └─────────────┘                       └─────────────────┘│
└─────────────────────────────────────────────────────────┘
```
