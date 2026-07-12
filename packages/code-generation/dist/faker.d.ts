/**
 * Code Generation - Seeded Faker
 *
 * A deterministic seeded pseudo-random data generator for tests.
 * Same seed always produces the same output.
 */
export interface Faker {
    firstName(): string;
    lastName(): string;
    fullName(): string;
    email(): string;
    uuid(): string;
    phone(): string;
    address(): string;
    city(): string;
    country(): string;
    zipCode(): string;
    company(): string;
    department(): string;
    jobTitle(): string;
    word(): string;
    sentence(): string;
    paragraph(): string;
    number(min: number, max: number): number;
    boolean(): boolean;
}
/**
 * Create a seeded faker instance.
 * Same seed always produces identical output.
 */
export declare function createFaker(seed?: number): Faker;
//# sourceMappingURL=faker.d.ts.map