/**
 * Test Data Generator - Faker Adapter
 *
 * Simple faker implementation for data generation.
 */
import type { FakerAdapter, DateOptions } from "./types.js";
export declare class SimpleFaker implements FakerAdapter {
    private random;
    constructor(seed?: number, _locale?: string);
    /**
     * Pick random element from array
     */
    pick<T>(array: T[]): T;
    /**
     * Generate random string
     */
    string(min?: number, max?: number): string;
    /**
     * Generate random number
     */
    number(min?: number, max?: number): number;
    /**
     * Generate random boolean
     */
    boolean(): boolean;
    /**
     * Generate random date
     */
    date(options?: DateOptions): Date;
    /**
     * Generate email
     */
    email(): string;
    /**
     * Generate URL
     */
    url(): string;
    /**
     * Generate phone number
     */
    phone(): string;
    /**
     * Generate UUID
     */
    uuid(): string;
    /**
     * Generate first name
     */
    firstName(): string;
    /**
     * Generate last name
     */
    lastName(): string;
    /**
     * Generate full name
     */
    fullName(): string;
    /**
     * Generate address
     */
    address(): string;
    /**
     * Generate city
     */
    city(): string;
    /**
     * Generate country
     */
    country(): string;
    /**
     * Generate zip code
     */
    zipCode(): string;
    /**
     * Generate company name
     */
    company(): string;
    /**
     * Generate department
     */
    department(): string;
    /**
     * Generate job title
     */
    jobTitle(): string;
    /**
     * Generate paragraph
     */
    paragraph(sentences?: number): string;
    /**
     * Generate sentence
     */
    sentence(): string;
    /**
     * Generate word
     */
    word(): string;
    /**
     * Generate lorem text
     */
    lorem(words?: number): string;
    /**
     * Generate image URL
     */
    image(width?: number, height?: number): string;
    /**
     * Generate avatar URL
     */
    avatar(): string;
    /**
     * Generate color name
     */
    color(): string;
    /**
     * Generate hex color
     */
    hexColor(): string;
    /**
     * Generate IPv4 address
     */
    ipv4(): string;
    /**
     * Generate IPv6 address
     */
    ipv6(): string;
    /**
     * Generate username
     */
    userName(): string;
    /**
     * Generate password
     */
    password(length?: number): string;
    /**
     * Generate credit card number (fake)
     */
    creditCard(): string;
    /**
     * Generate currency code
     */
    currency(): string;
    /**
     * Generate locale
     */
    locale(): string;
    /**
     * Generate file name
     */
    fileName(ext?: string): string;
    /**
     * Generate file path
     */
    filePath(): string;
    /**
     * Generate MIME type
     */
    mimeType(): string;
    /**
     * Generate latitude
     */
    latitude(): number;
    /**
     * Generate longitude
     */
    longitude(): number;
    /**
     * Set seed for reproducibility
     */
    setSeed(seed: number): void;
}
/**
 * Create a faker adapter
 */
export declare function createFaker(seed?: number, locale?: string): FakerAdapter;
//# sourceMappingURL=faker-adapter.d.ts.map