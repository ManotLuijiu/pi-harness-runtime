/**
 * Code Generation - Seeded Faker
 *
 * A deterministic seeded pseudo-random data generator for tests.
 * Same seed always produces the same output.
 */

// ─── Seeded RNG ─────────────────────────────────────────────────────────

/**
 * Mulberry32 — fast, seedable, good distribution.
 */
function mulberry32(initialSeed: number): () => number {
	let seed = initialSeed;
	return () => {
		seed = (seed + 0x6d2b79f5) >>> 0;
		let t = seed;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ─── Data pools ────────────────────────────────────────────────────────

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
	"Barbara",
	"David",
	"Elizabeth",
	"Richard",
	"Susan",
	"Joseph",
	"Jessica",
	"Thomas",
	"Sarah",
	"Charles",
	"Karen",
	"Daniel",
	"Nancy",
	"Matthew",
	"Lisa",
	"Anthony",
	"Betty",
	"Mark",
	"Margaret",
	"Donald",
	"Sandra",
	"Steven",
	"Ashley",
	"Andrew",
	"Dorothy",
	"Paul",
	"Kimberly",
	"Joshua",
	"Emily",
	"Kenneth",
	"Donna",
	"Kevin",
	"Michelle",
	"Brian",
	"Carol",
	"George",
	"Amanda",
	"Timothy",
	"Melissa",
	"Ronald",
	"Deborah",
	"Edward",
	"Stephanie",
	"Jason",
	"Rebecca",
	"Jeffrey",
	"Sharon",
	"Ryan",
	"Laura",
	"Jacob",
	"Cynthia",
	"Gary",
	"Kathleen",
	"Nicholas",
	"Amy",
	"Eric",
	"Angela",
	"Jonathan",
	"Shirley",
	"Stephen",
	"Anna",
	"Larry",
	"Brenda",
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
	"White",
	"Harris",
	"Sanchez",
	"Clark",
	"Ramirez",
	"Lewis",
	"Robinson",
	"Walker",
	"Young",
	"Allen",
	"King",
	"Wright",
	"Scott",
	"Torres",
	"Nguyen",
	"Hill",
	"Flores",
	"Green",
	"Adams",
	"Nelson",
	"Baker",
	"Hall",
	"Rivera",
	"Campbell",
	"Mitchell",
	"Carter",
	"Roberts",
	"Gomez",
	"Phillips",
	"Evans",
	"Turner",
	"Diaz",
	"Parker",
	"Cruz",
	"Edwards",
	"Collins",
	"Reyes",
	"Stewart",
	"Morris",
	"Morales",
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
	"Fort Worth",
	"Columbus",
	"Charlotte",
	"San Francisco",
	"Indianapolis",
	"Seattle",
	"Denver",
	"Boston",
	"El Paso",
	"Nashville",
	"Portland",
	"Las Vegas",
	"Detroit",
];

const COUNTRIES = [
	"United States",
	"Canada",
	"United Kingdom",
	"Germany",
	"France",
	"Japan",
	"Australia",
	"Brazil",
	"India",
	"Mexico",
	"Spain",
	"Italy",
	"Netherlands",
	"South Korea",
	"Argentina",
	"Thailand",
	"Vietnam",
	"Singapore",
	"Malaysia",
	"Indonesia",
];

const DEPARTMENTS = [
	"Engineering",
	"Sales",
	"Marketing",
	"Finance",
	"Human Resources",
	"Operations",
	"Legal",
	"Customer Support",
	"Product",
	"Research and Development",
	"Design",
];

const JOB_TITLES = [
	"Software Engineer",
	"Product Manager",
	"Data Analyst",
	"Designer",
	"Accountant",
	"Marketing Manager",
	"Sales Representative",
	"HR Specialist",
	"Project Manager",
	"Business Analyst",
	"DevOps Engineer",
	"QA Engineer",
	"Frontend Developer",
	"Backend Developer",
	"Full Stack Developer",
	"Technical Lead",
	"CTO",
	"CEO",
	"VP of Engineering",
	"Director of Product",
	"Head of Sales",
];

const EMAIL_DOMAINS = [
	"gmail.com",
	"yahoo.com",
	"outlook.com",
	"hotmail.com",
	"protonmail.com",
	"company.com",
	"work.org",
	"example.net",
];

const WORDS = [
	"alpha",
	"beta",
	"gamma",
	"delta",
	"epsilon",
	"zeta",
	"theta",
	"lambda",
	"sigma",
	"omega",
	"pixel",
	"vector",
	"matrix",
	"tensor",
	"scalar",
	"node",
	"graph",
	"tree",
	"stack",
	"queue",
	"heap",
	"hash",
	"cache",
	"proxy",
	"server",
	"client",
	"router",
	"bridge",
	"gateway",
	"cluster",
	"shard",
];

// ─── Faker interface ──────────────────────────────────────────────────

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

// ─── Implementation ──────────────────────────────────────────────────

function pick<T>(rng: () => number, arr: T[]): T {
	return arr[Math.floor(rng() * arr.length)] as T;
}

function randomInt(rng: () => number, min: number, max: number): number {
	return Math.floor(rng() * (max - min + 1)) + min;
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function sentenceCase(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Create a seeded faker instance.
 * Same seed always produces identical output.
 */
export function createFaker(seed?: number): Faker {
	const rng = seed !== undefined ? mulberry32(seed) : Math.random;

	return {
		firstName(): string {
			return capitalize(pick(rng, FIRST_NAMES));
		},

		lastName(): string {
			return capitalize(pick(rng, LAST_NAMES));
		},

		fullName(): string {
			return `${this.firstName()} ${this.lastName()}`;
		},

		email(): string {
			const first = pick(rng, FIRST_NAMES).toLowerCase();
			const last = pick(rng, LAST_NAMES).toLowerCase();
			const domain = pick(rng, EMAIL_DOMAINS);
			const num = randomInt(rng, 0, 99);
			return `${first}.${last}${num}@${domain}`;
		},

		uuid(): string {
			const hex = (n: number) =>
				n
					.toString(16)
					.padStart(8, "0")
					.replace(/([0-9a-f]{4})/g, "$1-")
					.replace(/-$/, "");
			const p1 = Math.floor(rng() * 0xffffffff);
			const p2 = Math.floor(rng() * 0xffff);
			const p3 = Math.floor(rng() * 0xffff);
			const p4 = Math.floor(rng() * 0xffffffffffff);
			return `${hex(p1)}-${hex(p2).slice(0, 4)}-${hex(p3).slice(0, 4)}-${hex(p4).slice(0, 12)}`;
		},

		phone(): string {
			const area = randomInt(rng, 200, 999);
			const exchange = randomInt(rng, 200, 999);
			const subscriber = randomInt(rng, 1000, 9999);
			return `+1 (${area}) ${exchange}-${subscriber}`;
		},

		address(): string {
			const num = randomInt(rng, 1, 9999);
			const street = capitalize(pick(rng, WORDS));
			const types = ["St", "Ave", "Blvd", "Dr", "Ln", "Rd", "Way", "Ct"];
			return `${num} ${street} ${pick(rng, types)}`;
		},

		city(): string {
			return pick(rng, CITIES);
		},

		country(): string {
			return pick(rng, COUNTRIES);
		},

		zipCode(): string {
			return `${randomInt(rng, 10000, 99999)}`;
		},

		company(): string {
			const suffixes = [
				"Inc",
				"LLC",
				"Corp",
				"Ltd",
				"Group",
				"Solutions",
				"Systems",
				"Technologies",
			];
			return `${capitalize(pick(rng, WORDS))} ${pick(rng, suffixes)}`;
		},

		department(): string {
			return pick(rng, DEPARTMENTS);
		},

		jobTitle(): string {
			return pick(rng, JOB_TITLES);
		},

		word(): string {
			return pick(rng, WORDS);
		},

		sentence(): string {
			const wordCount = randomInt(rng, 6, 12);
			const sentenceWords = Array.from({ length: wordCount }, () =>
				wordCount > 1 ? pick(rng, WORDS) : pick(rng, WORDS),
			);
			return sentenceCase(`${sentenceWords.join(" ")}.`);
		},

		paragraph(): string {
			const sentenceCount = randomInt(rng, 3, 6);
			return Array.from({ length: sentenceCount }, () => this.sentence()).join(
				" ",
			);
		},

		number(min: number, max: number): number {
			return randomInt(rng, min, max);
		},

		boolean(): boolean {
			return rng() < 0.5;
		},
	};
}
