export type User = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "manager" | "receptionist" | "staff" | "customer";
  staffId?: string;
  clientId?: string;
};
export type Location = {
  id: string;
  name: string;
  address: string;
  timezone?: string;
};
export type Professional = {
  id: string;
  name: string;
  title: string;
  locationId: string;
  locationIds?: string[];
  active: boolean;
};
export type Service = {
  id: string;
  name: string;
  price: number;
  duration: number;
  locationPrices?: Record<string, number>;
};
export type Client = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  notes?: string;
  points: number;
  marketingConsent: boolean;
};
export type Appointment = {
  id: string;
  client_id: string;
  staff_id: string;
  service_id: string;
  location_id: string;
  start: string;
  end: string;
  status: string;
  price: number;
  notes?: string;
  service_ids?: string;
};
export type Message = {
  id: string;
  clientId: string;
  body: string;
  sender: string;
  created: string;
};
export type Order = {
  id: string;
  total: number;
  status: string;
  created: string;
  appointment_id?: string;
};
export type Catalog = {
  settings: {
    name: string;
    timezone: string;
    currency: string;
    cancelHours: number;
    bookingDays: number;
  };
  locations: Location[];
  staff: Professional[];
  services: Service[];
};
export type Portal = {
  profile: Client;
  appointments: Appointment[];
  orders: Order[];
  memberships: {
    id: string;
    plan_id: string;
    status: string;
    credits: number;
  }[];
  messages: Message[];
};
export type Workspace = {
  appointments: Appointment[];
  clients: Client[];
  staff: Professional[];
  timesheets?: { id: string; staffId: string; start: string; end?: string }[];
  blocks?: { id: string; staffId: string; start: string; end: string }[];
};
export type Slot = { start: string; end: string };
