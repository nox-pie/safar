// Delhi Metro network: the compiler's "symbol table".
//
// Each line is a list of services; a service is an ordered run of stations that a
// single train covers end to end. Branch lines (Blue → Vaishali, Green → Kirti Nagar)
// are modelled as extra services sharing track with the main one, so the checker can
// tell when a ride needs a change of train at the junction.
//
// Snapshot of the operational network; Phase 4 extensions still under construction
// (Golden line, Pink ring closure via Majlis Park–Maujpur, Magenta beyond Krishna Park
// Extension) are not included. Verify against the current DMRC map before relying on it.

export interface RawLine {
  id: string;
  name: string;
  color: string;
  aliases: string[];
  minutesPerHop: number;
  services: string[][];
}

const RED = [
  'Rithala', 'Rohini West', 'Rohini East', 'Pitampura', 'Kohat Enclave',
  'Netaji Subhash Place', 'Keshav Puram', 'Kanhaiya Nagar', 'Inderlok', 'Shastri Nagar',
  'Pratap Nagar', 'Pulbangash', 'Tis Hazari', 'Kashmere Gate', 'Shastri Park',
  'Seelampur', 'Welcome', 'Shahdara', 'Mansarovar Park', 'Jhilmil',
  'Dilshad Garden', 'Shaheed Nagar', 'Raj Bagh', 'Major Mohit Sharma Rajendra Nagar',
  'Shyam Park', 'Mohan Nagar', 'Arthala', 'Hindon River', 'Shaheed Sthal (New Bus Adda)',
];

const YELLOW = [
  'Samaypur Badli', 'Rohini Sector 18-19', 'Haiderpur Badli Mor', 'Jahangirpuri',
  'Adarsh Nagar', 'Azadpur', 'Model Town', 'GTB Nagar', 'Vishwavidyalaya', 'Vidhan Sabha',
  'Civil Lines', 'Kashmere Gate', 'Chandni Chowk', 'Chawri Bazar', 'New Delhi',
  'Rajiv Chowk', 'Patel Chowk', 'Central Secretariat', 'Udyog Bhawan', 'Lok Kalyan Marg',
  'Jor Bagh', 'Dilli Haat INA', 'AIIMS', 'Green Park', 'Hauz Khas',
  'Malviya Nagar', 'Saket', 'Qutab Minar', 'Chhatarpur', 'Sultanpur',
  'Ghitorni', 'Arjan Garh', 'Guru Dronacharya', 'Sikanderpur', 'MG Road',
  'IFFCO Chowk', 'Millennium City Centre Gurugram',
];

const BLUE_MAIN = [
  'Dwarka Sector 21', 'Dwarka Sector 8', 'Dwarka Sector 9', 'Dwarka Sector 10',
  'Dwarka Sector 11', 'Dwarka Sector 12', 'Dwarka Sector 13', 'Dwarka Sector 14',
  'Dwarka', 'Dwarka Mor', 'Nawada', 'Uttam Nagar West', 'Uttam Nagar East',
  'Janakpuri West', 'Janakpuri East', 'Tilak Nagar', 'Subhash Nagar', 'Tagore Garden',
  'Rajouri Garden', 'Ramesh Nagar', 'Moti Nagar', 'Kirti Nagar', 'Shadipur',
  'Patel Nagar', 'Rajendra Place', 'Karol Bagh', 'Jhandewalan', 'Ramakrishna Ashram Marg',
  'Rajiv Chowk', 'Barakhamba Road', 'Mandi House', 'Supreme Court', 'Indraprastha',
  'Yamuna Bank', 'Akshardham', 'Mayur Vihar Phase-1', 'Mayur Vihar Extension',
  'New Ashok Nagar', 'Noida Sector 15', 'Noida Sector 16', 'Noida Sector 18',
  'Botanical Garden', 'Golf Course', 'Noida City Centre', 'Noida Sector 34',
  'Noida Sector 52', 'Noida Sector 61', 'Noida Sector 59', 'Noida Sector 62',
  'Noida Electronic City',
];

const BLUE_BRANCH = [
  'Yamuna Bank', 'Laxmi Nagar', 'Nirman Vihar', 'Preet Vihar', 'Karkarduma',
  'Anand Vihar ISBT', 'Kaushambi', 'Vaishali',
];

const GREEN_MAIN = [
  'Inderlok', 'Ashok Park Main', 'Punjabi Bagh', 'Shivaji Park', 'Madipur',
  'Paschim Vihar East', 'Paschim Vihar West', 'Peeragarhi', 'Udyog Nagar',
  'Maharaja Surajmal Stadium', 'Nangloi', 'Nangloi Railway Station', 'Rajdhani Park',
  'Mundka', 'Mundka Industrial Area', 'Ghevra', 'Tikri Kalan', 'Tikri Border',
  'Pandit Shree Ram Sharma', 'Bahadurgarh City', 'Brigadier Hoshiyar Singh',
];

const GREEN_BRANCH = ['Kirti Nagar', 'Satguru Ram Singh Marg', 'Ashok Park Main'];

const VIOLET = [
  'Kashmere Gate', 'Lal Qila', 'Jama Masjid', 'Delhi Gate', 'ITO', 'Mandi House',
  'Janpath', 'Central Secretariat', 'Khan Market', 'Jawaharlal Nehru Stadium',
  'Jangpura', 'Lajpat Nagar', 'Moolchand', 'Kailash Colony', 'Nehru Place',
  'Kalkaji Mandir', 'Govind Puri', 'Harkesh Nagar Okhla', 'Jasola Apollo', 'Sarita Vihar',
  'Mohan Estate', 'Tughlakabad Station', 'Badarpur Border', 'Sarai', 'NHPC Chowk',
  'Mewala Maharajpur', 'Sector 28', 'Badkal Mor', 'Old Faridabad', 'Neelam Chowk Ajronda',
  'Bata Chowk', 'Escorts Mujesar', 'Sant Surdas (Sihi)', 'Raja Nahar Singh',
];

const PINK = [
  'Majlis Park', 'Azadpur', 'Shalimar Bagh', 'Netaji Subhash Place', 'Shakurpur',
  'Punjabi Bagh West', 'ESI Basaidarapur', 'Rajouri Garden', 'Maya Puri', 'Naraina Vihar',
  'Delhi Cantt', 'Durgabai Deshmukh South Campus', 'Sir M. Vishweshwaraiah Moti Bagh',
  'Bhikaji Cama Place', 'Sarojini Nagar', 'Dilli Haat INA', 'South Extension',
  'Lajpat Nagar', 'Vinobapuri', 'Ashram', 'Hazrat Nizamuddin', 'Mayur Vihar Phase-1',
  'Mayur Vihar Pocket 1', 'Trilokpuri Sanjay Lake', 'East Vinod Nagar - Mayur Vihar-II',
  'Mandawali - West Vinod Nagar', 'IP Extension', 'Anand Vihar ISBT', 'Karkarduma',
  'Karkarduma Court', 'Krishna Nagar', 'East Azad Nagar', 'Welcome', 'Jaffrabad',
  'Maujpur - Babarpur', 'Gokulpuri', 'Johri Enclave', 'Shiv Vihar',
];

const MAGENTA = [
  'Krishna Park Extension', 'Janakpuri West', 'Dabri Mor - Janakpuri South', 'Dashrath Puri',
  'Palam', 'Sadar Bazaar Cantonment', 'Terminal 1 IGI Airport', 'Shankar Vihar',
  'Vasant Vihar', 'Munirka', 'R.K. Puram', 'IIT Delhi', 'Hauz Khas', 'Panchsheel Park',
  'Chirag Delhi', 'Greater Kailash', 'Nehru Enclave', 'Kalkaji Mandir', 'Okhla NSIC',
  'Sukhdev Vihar', 'Jamia Millia Islamia', 'Okhla Vihar', 'Jasola Vihar Shaheen Bagh',
  'Kalindi Kunj', 'Okhla Bird Sanctuary', 'Botanical Garden',
];

const AIRPORT_EXPRESS = [
  'New Delhi', 'Shivaji Stadium', 'Dhaula Kuan', 'Delhi Aerocity', 'IGI Airport',
  'Dwarka Sector 21', 'Yashobhoomi Dwarka Sector 25',
];

const GREY = ['Dwarka', 'Nangli', 'Najafgarh', 'Dhansa Bus Stand'];

function through(list: string[], station: string): string[] {
  const i = list.indexOf(station);
  if (i < 0) throw new Error(`${station} is not in list`);
  return list.slice(0, i + 1);
}

function after(list: string[], station: string): string[] {
  const i = list.indexOf(station);
  if (i < 0) throw new Error(`${station} is not in list`);
  return list.slice(i + 1);
}

export const LINES: RawLine[] = [
  { id: 'red', name: 'Red', color: '#E4252D', aliases: [], minutesPerHop: 2.2, services: [RED] },
  { id: 'yellow', name: 'Yellow', color: '#FFC20E', aliases: [], minutesPerHop: 2.2, services: [YELLOW] },
  {
    id: 'blue', name: 'Blue', color: '#1D6FC4', aliases: [], minutesPerHop: 2.2,
    services: [BLUE_MAIN, [...through(BLUE_MAIN, 'Yamuna Bank'), ...after(BLUE_BRANCH, 'Yamuna Bank')]],
  },
  {
    id: 'green', name: 'Green', color: '#2DA44E', aliases: [], minutesPerHop: 2.2,
    services: [GREEN_MAIN, [...GREEN_BRANCH, ...after(GREEN_MAIN, 'Ashok Park Main')]],
  },
  { id: 'violet', name: 'Violet', color: '#8B3FA8', aliases: ['Purple'], minutesPerHop: 2.2, services: [VIOLET] },
  { id: 'pink', name: 'Pink', color: '#F06EAA', aliases: [], minutesPerHop: 2.2, services: [PINK] },
  { id: 'magenta', name: 'Magenta', color: '#B5197F', aliases: [], minutesPerHop: 2.2, services: [MAGENTA] },
  {
    id: 'airport', name: 'Airport Express', color: '#F47B20', aliases: ['Orange', 'Airport'],
    minutesPerHop: 4.5, services: [AIRPORT_EXPRESS],
  },
  { id: 'grey', name: 'Grey', color: '#8D939B', aliases: ['Gray'], minutesPerHop: 2.5, services: [GREY] },
];

// Alternate and former names → canonical station name.
export const STATION_ALIASES: Record<string, string> = {
  'Connaught Place': 'Rajiv Chowk',
  'CP': 'Rajiv Chowk',
  'Kashmiri Gate': 'Kashmere Gate',
  'INA': 'Dilli Haat INA',
  'Pragati Maidan': 'Supreme Court',
  'Race Course': 'Lok Kalyan Marg',
  'HUDA City Centre': 'Millennium City Centre Gurugram',
  'Millennium City Centre': 'Millennium City Centre Gurugram',
  'Qutub Minar': 'Qutab Minar',
  'Delhi University': 'Vishwavidyalaya',
  'Badarpur': 'Badarpur Border',
  'Ballabhgarh': 'Raja Nahar Singh',
  'Shaheed Sthal': 'Shaheed Sthal (New Bus Adda)',
  'New Bus Adda': 'Shaheed Sthal (New Bus Adda)',
  'Anand Vihar': 'Anand Vihar ISBT',
  'Sarai Kale Khan': 'Hazrat Nizamuddin',
  'Nizamuddin': 'Hazrat Nizamuddin',
  'Moti Bagh': 'Sir M. Vishweshwaraiah Moti Bagh',
  'South Campus': 'Durgabai Deshmukh South Campus',
  'Aerocity': 'Delhi Aerocity',
  'IGI Airport T3': 'IGI Airport',
  'Terminal 3': 'IGI Airport',
  'T3': 'IGI Airport',
  'Terminal 1': 'Terminal 1 IGI Airport',
  'T1': 'Terminal 1 IGI Airport',
  'Yashobhoomi': 'Yashobhoomi Dwarka Sector 25',
  'Mundka Industrial Area (MIA)': 'Mundka Industrial Area',
};
