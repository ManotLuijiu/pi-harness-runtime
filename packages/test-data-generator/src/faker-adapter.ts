/**
 * Test Data Generator - Faker Adapter
 *
 * Simple faker implementation for data generation.
 */

import type { FakerAdapter, DateOptions } from "./types.js";

// ─── Seeded Random ─────────────────────────────────────────────────────────

class SeededRandom {
	private seed: number;

	constructor(seed: number) {
		this.seed = seed;
	}

	next(): number {
		this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
		return this.seed / 0x7fffffff;
	}

	nextInt(min: number, max: number): number {
		return Math.floor(this.next() * (max - min + 1)) + min;
	}

	pick<T>(array: T[]): T {
		return array[Math.floor(this.next() * array.length)];
	}

	shuffle<T>(array: T[]): T[] {
		const result = [...array];
		for (let i = result.length - 1; i > 0; i--) {
			const j = Math.floor(this.next() * (i + 1));
			[result[i], result[j]] = [result[j], result[i]];
		}
		return result;
	}
}

// ─── Data Samples ─────────────────────────────────────────────────────────

const FIRST_NAMES = [
	"James",
	"Mary",
	"John",
	"Patricia",
	"Robert",
	"Jennifer",
	"Michael",
	"Linda",
	"William",
	"Elizabeth",
	"David",
	"Barbara",
	"Richard",
	"Susan",
	"Joseph",
	"Jessica",
	"Thomas",
	"Sarah",
	"Charles",
	"Karen",
	"Christopher",
	"Nancy",
	"Daniel",
	"Lisa",
];

const LAST_NAMES = [
	"Smith",
	"Johnson",
	"Williams",
	"Brown",
	"Jones",
	"Garcia",
	"Miller",
	"Davis",
	"Rodriguez",
	"Martinez",
	"Hernandez",
	"Lopez",
	"Gonzalez",
	"Wilson",
	"Anderson",
	"Thomas",
	"Taylor",
	"Moore",
	"Jackson",
	"Martin",
	"Lee",
	"Perez",
	"Thompson",
];

const CITIES = [
	"New York",
	"Los Angeles",
	"Chicago",
	"Houston",
	"Phoenix",
	"Philadelphia",
	"San Antonio",
	"San Diego",
	"Dallas",
	"San Jose",
	"Austin",
	"Jacksonville",
	"London",
	"Paris",
	"Berlin",
	"Tokyo",
	"Sydney",
	"Toronto",
	"Vancouver",
];

const COUNTRIES = [
	"United States",
	"United Kingdom",
	"Canada",
	"Australia",
	"Germany",
	"France",
	"Japan",
	"China",
	"India",
	"Brazil",
	"Mexico",
	"Spain",
	"Italy",
];

const STREET_NAMES = [
	"Main",
	"Oak",
	"Maple",
	"Cedar",
	"Pine",
	"Elm",
	"Washington",
	"Lake",
	"Hill",
	"Park",
	"Walnut",
	"Sunset",
	"Spring",
	"River",
	"Highland",
];

const STREET_TYPES = ["St", "Ave", "Blvd", "Dr", "Ln", "Rd", "Way", "Ct"];

const COMPANIES = [
	"Acme Corp",
	"Globex Industries",
	"Initech",
	"Umbrella Corp",
	"Stark Industries",
	"Wayne Enterprises",
	"Cyberdyne Systems",
	"Soylent Corp",
	"Weyland-Yutani",
	"Massive Dynamic",
	"Oscorp",
	"Prestige Worldwide",
	"Dunder Mifflin",
	"Sterling Cooper",
];

const JOB_TITLES = [
	"Software Engineer",
	"Product Manager",
	"Designer",
	"Data Scientist",
	"DevOps Engineer",
	"QA Engineer",
	"Tech Lead",
	"Engineering Manager",
	"Product Designer",
	"Data Analyst",
	"Frontend Developer",
	"Backend Developer",
];

const DEPARTMENTS = [
	"Engineering",
	"Product",
	"Design",
	"Marketing",
	"Sales",
	"Operations",
	"Finance",
	"HR",
	"Legal",
	"Customer Success",
	"Support",
];

const LOREM_WORDS = [
	"lorem",
	"ipsum",
	"dolor",
	"sit",
	"amet",
	"consectetur",
	"adipiscing",
	"elit",
	"sed",
	"do",
	"eiusmod",
	"tempor",
	"incididunt",
	"ut",
	"labore",
	"et",
	"dolore",
	"magna",
	"aliqua",
	"enim",
	"ad",
	"minim",
	"veniam",
];

const TLDs = ["com", "net", "org", "io", "co", "dev", "app"];

// ─── Faker Adapter ─────────────────────────────────────────────────────────

export class SimpleFaker implements FakerAdapter {
	private random: SeededRandom;

	constructor(seed?: number, _locale: string = "en") {
		this.random = new SeededRandom(seed ?? Date.now());
	}

	/**
	 * Pick random element from array
	 */
	pick<T>(array: T[]): T {
		return this.random.pick(array);
	}

	/**
	 * Generate random string
	 */
	string(min = 5, max = 20): string {
		const length = this.random.nextInt(min, max);
		let result = "";
		const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
		for (let i = 0; i < length; i++) {
			result += chars[this.random.nextInt(0, chars.length - 1)];
		}
		return result;
	}

	/**
	 * Generate random number
	 */
	number(min = 0, max = 100): number {
		return this.random.nextInt(min, max);
	}

	/**
	 * Generate random boolean
	 */
	boolean(): boolean {
		return this.random.next() > 0.5;
	}

	/**
	 * Generate random date
	 */
	date(options?: DateOptions): Date {
		const now = new Date();
		let minDate: Date;
		let maxDate: Date;

		if (options?.min) {
			minDate = new Date(options.min);
		} else if (options?.past) {
			minDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
		} else {
			minDate = new Date(now.getTime() - 10 * 365 * 24 * 60 * 60 * 1000);
		}

		if (options?.max) {
			maxDate = new Date(options.max);
		} else if (options?.future) {
			maxDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
		} else {
			maxDate = now;
		}

		const time =
			minDate.getTime() +
			this.random.next() * (maxDate.getTime() - minDate.getTime());
		return new Date(time);
	}

	/**
	 * Generate email
	 */
	email(): string {
		const firstName = this.firstName().toLowerCase();
		const lastName = this.lastName().toLowerCase();
		const tld = this.random.pick(TLDs);
		const separator = this.random.pick([".", "_", ""]);
		const number = this.random.next() > 0.7 ? this.random.nextInt(1, 99) : "";

		return `${firstName}${separator}${lastName}${number}@${firstName}.${tld}`;
	}

	/**
	 * Generate URL
	 */
	url(): string {
		const domain = this.string(5, 15).toLowerCase();
		const tld = this.random.pick(TLDs);
		return `https://${domain}.${tld}`;
	}

	/**
	 * Generate phone number
	 */
	phone(): string {
		const area = this.random.nextInt(200, 999);
		const exchange = this.random.nextInt(200, 999);
		const subscriber = this.random.nextInt(1000, 9999);
		return `(${area}) ${exchange}-${subscriber}`;
	}

	/**
	 * Generate UUID
	 */
	uuid(): string {
		const hex = (n: number) => n.toString(16).padStart(2, "0");
		const bytes = Array.from({ length: 16 }, () =>
			hex(this.random.nextInt(0, 255)),
		);

		// Format as UUID
		return [
			bytes.slice(0, 4).join(""),
			bytes.slice(4, 8).join(""),
			bytes.slice(8, 12).join(""),
			bytes.slice(12, 16).join(""),
		].join("-");
	}

	/**
	 * Generate first name
	 */
	firstName(): string {
		return this.random.pick(FIRST_NAMES);
	}

	/**
	 * Generate last name
	 */
	lastName(): string {
		return this.random.pick(LAST_NAMES);
	}

	/**
	 * Generate full name
	 */
	fullName(): string {
		return `${this.firstName()} ${this.lastName()}`;
	}

	/**
	 * Generate address
	 */
	address(): string {
		const number = this.random.nextInt(1, 9999);
		const street = this.random.pick(STREET_NAMES);
		const type = this.random.pick(STREET_TYPES);
		return `${number} ${street} ${type}`;
	}

	/**
	 * Generate city
	 */
	city(): string {
		return this.random.pick(CITIES);
	}

	/**
	 * Generate country
	 */
	country(): string {
		return this.random.pick(COUNTRIES);
	}

	/**
	 * Generate zip code
	 */
	zipCode(): string {
		return this.random.nextInt(10000, 99999).toString();
	}

	/**
	 * Generate company name
	 */
	company(): string {
		return this.random.pick(COMPANIES);
	}

	/**
	 * Generate department
	 */
	department(): string {
		return this.random.pick(DEPARTMENTS);
	}

	/**
	 * Generate job title
	 */
	jobTitle(): string {
		return this.random.pick(JOB_TITLES);
	}

	/**
	 * Generate paragraph
	 */
	paragraph(sentences = 4): string {
		const sents: string[] = [];
		for (let i = 0; i < sentences; i++) {
			sents.push(this.sentence());
		}
		return sents.join(" ");
	}

	/**
	 * Generate sentence
	 */
	sentence(): string {
		const words = this.random.nextInt(8, 15);
		const parts: string[] = [];

		parts.push(this.word().charAt(0).toUpperCase() + this.word().slice(1));

		for (let i = 1; i < words; i++) {
			parts.push(this.word());
		}

		return parts.join(" ") + ".";
	}

	/**
	 * Generate word
	 */
	word(): string {
		return this.random.pick(LOREM_WORDS);
	}

	/**
	 * Generate lorem text
	 */
	lorem(words = 50): string {
		const result: string[] = [];
		for (let i = 0; i < words; i++) {
			result.push(this.word());
		}
		return result.join(" ");
	}

	/**
	 * Generate image URL
	 */
	image(width = 640, height = 480): string {
		return `https://picsum.photos/${width}/${height}?random=${this.random.nextInt(1, 1000)}`;
	}

	/**
	 * Generate avatar URL
	 */
	avatar(): string {
		const seed = this.string(10, 20);
		return `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`;
	}

	/**
	 * Generate color name
	 */
	color(): string {
		const colors = [
			"red",
			"blue",
			"green",
			"yellow",
			"orange",
			"purple",
			"pink",
			"brown",
			"black",
			"white",
			"gray",
			"cyan",
			"magenta",
			"violet",
			"indigo",
		];
		return this.random.pick(colors);
	}

	/**
	 * Generate hex color
	 */
	hexColor(): string {
		const hex = () => this.random.nextInt(0, 255).toString(16).padStart(2, "0");
		return `#${hex()}${hex()}${hex()}`;
	}

	/**
	 * Generate IPv4 address
	 */
	ipv4(): string {
		return `${this.random.nextInt(1, 255)}.${this.random.nextInt(0, 255)}.${this.random.nextInt(0, 255)}.${this.random.nextInt(1, 254)}`;
	}

	/**
	 * Generate IPv6 address
	 */
	ipv6(): string {
		const hex = () =>
			this.random.nextInt(0, 65535).toString(16).padStart(4, "0");
		return `${hex()}:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}`;
	}

	/**
	 * Generate username
	 */
	userName(): string {
		const first = this.firstName().toLowerCase();
		const last = this.lastName().toLowerCase();
		const separator = this.random.pick(["", "_", "."]);
		const number = this.random.next() > 0.5 ? this.random.nextInt(1, 999) : "";

		return `${first}${separator}${last}${number}`;
	}

	/**
	 * Generate password
	 */
	password(length = 16): string {
		const chars =
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
		let result = "";
		for (let i = 0; i < length; i++) {
			result += chars[this.random.nextInt(0, chars.length - 1)];
		}
		return result;
	}

	/**
	 * Generate credit card number (fake)
	 */
	creditCard(): string {
		// Generate a fake valid-format card number
		const prefix = this.random.pick(["4111", "5500", "3400", "3782"]);
		let number = prefix;
		for (let i = 0; i < 12; i++) {
			number += this.random.nextInt(0, 9).toString();
		}
		return number;
	}

	/**
	 * Generate currency code
	 */
	currency(): string {
		return this.random.pick(["USD", "EUR", "GBP", "JPY", "CAD", "AUD"]);
	}

	/**
	 * Generate locale
	 */
	locale(): string {
		const locales = ["en_US", "en_GB", "de_DE", "fr_FR", "es_ES", "it_IT"];
		return this.random.pick(locales);
	}

	/**
	 * Generate file name
	 */
	fileName(ext = "txt"): string {
		const name = this.string(5, 15);
		return `${name}.${ext}`;
	}

	/**
	 * Generate file path
	 */
	filePath(): string {
		const depth = this.random.nextInt(1, 4);
		const parts: string[] = ["/home", "user"];

		for (let i = 0; i < depth; i++) {
			parts.push(this.string(3, 10));
		}

		parts.push(this.fileName());
		return parts.join("/");
	}

	/**
	 * Generate MIME type
	 */
	mimeType(): string {
		const types = [
			"text/plain",
			"text/html",
			"text/css",
			"text/csv",
			"application/json",
			"application/xml",
			"application/pdf",
			"image/png",
			"image/jpeg",
			"image/gif",
			"image/svg+xml",
		];
		return this.random.pick(types);
	}

	/**
	 * Generate latitude
	 */
	latitude(): number {
		return this.random.nextInt(-90, 90) + this.random.next();
	}

	/**
	 * Generate longitude
	 */
	longitude(): number {
		return this.random.nextInt(-180, 180) + this.random.next();
	}

	/**
	 * Set seed for reproducibility
	 */
	setSeed(seed: number): void {
		this.random = new SeededRandom(seed);
	}
}

// ─── Factory Function ──────────────────────────────────────────────────────

/**
 * Create a faker adapter
 */
export function createFaker(seed?: number, locale?: string): FakerAdapter {
	return new SimpleFaker(seed, locale);
}
