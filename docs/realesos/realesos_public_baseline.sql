-- =============================================================================
-- RealesOS — Basisschema `public` für die DMS-Entwicklung (nur Struktur, keine Kundendaten)
-- -----------------------------------------------------------------------------
-- Zweck:   Lokale Entwicklungsdatenbank für das DMS-Zusatzmodul. Enthält genau die
--          RealesOS-Tabellen, die das DMS liest oder auf die es verweist, sowie die
--          Hilfsfunktionen für RLS (get_user_tenant_id, has_role, user_has_permission,
--          update_updated_at). Erzeugt aus dem Systemkatalog der RealesOS-Entwicklungs-
--          instanz, Stand 2026-10-06.
-- Bewusst NICHT enthalten:
--   * alle übrigen RealesOS-Tabellen; Fremdschlüssel dorthin sind weggelassen
--   * Trigger, Views (z. B. person_role_facts), Cron-Jobs, Storage-Buckets
--   * Policies, die nicht enthaltene Tabellen oder Funktionen verwenden
--   * Kundendaten. Daten sind nur Konfiguration: Modulkatalog und Rollenrechte.
-- Verwendung: lokal mit `supabase start`; diese Datei als erste Migration einspielen
--   oder per `psql -f`. NIE gegen eine RealesOS-Instanz ausführen.
-- Bei der Integration wird diese Datei NICHT übernommen — RealesOS hat das echte Schema.
-- =============================================================================

-- 1. Aufzählungstypen
CREATE TYPE public.app_role AS ENUM ('admin', 'mitarbeiter', 'beirat', 'eigentuemer', 'hausgeist', 'facility');
CREATE TYPE public.business_type AS ENUM ('broker', 'property_manager', 'hybrid');
CREATE TYPE public.facility_ticket_priority AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE public.facility_ticket_status AS ENUM ('open', 'in_progress', 'on_hold', 'resolved', 'closed');
CREATE TYPE public.object_type AS ENUM ('anlage', 'haus', 'mittelhaus', 'eingang', 'sonstiges');
CREATE TYPE public.person_object_role AS ENUM ('hausmeister', 'verwaltungsbeirat', 'eigentuemer_vertreter', 'sonstiges');
CREATE TYPE public.person_type AS ENUM ('tenant', 'owner', 'verwalter');
CREATE TYPE public.service_order_status AS ENUM ('draft', 'open', 'in_progress', 'completed', 'cancelled');
CREATE TYPE public.task_priority AS ENUM ('niedrig', 'normal', 'hoch');
CREATE TYPE public.unit_type AS ENUM ('apartment', 'house', 'commercial', 'parking', 'storage');
CREATE TYPE public.verw_art AS ENUM ('WEG', 'MHV', 'SMV');

-- 2. Tabellen
CREATE TABLE public.business_partner_contacts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  business_partner_id uuid NOT NULL,
  location_id uuid,
  salutation text,
  first_name text NOT NULL,
  last_name text NOT NULL,
  "position" text,
  email text,
  phone text,
  mobile text,
  is_primary boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.business_partner_locations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  business_partner_id uuid NOT NULL,
  location_name text NOT NULL,
  street text,
  house_number text,
  postal_code text,
  city text,
  country text DEFAULT 'Deutschland'::text,
  phone text,
  email text,
  is_primary boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.business_partner_objects (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  business_partner_id uuid NOT NULL,
  object_id uuid NOT NULL,
  relationship_type text,
  start_date date,
  end_date date,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  relationship_types jsonb DEFAULT '[]'::jsonb,
  sub_object_id uuid
);

CREATE TABLE public.business_partners (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  company_name text NOT NULL,
  industry text,
  specialization text,
  website text,
  email text,
  phone text,
  notes text,
  is_active boolean DEFAULT true,
  meta_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.company_persons (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  person_id uuid NOT NULL,
  company_role text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.cost_entries (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  object_id uuid NOT NULL,
  billing_period_id uuid,
  key_definition_id uuid,
  entry_date date NOT NULL,
  amount numeric(12,2) NOT NULL,
  vat_amount numeric(12,2) DEFAULT 0,
  vat_rate numeric(5,2) DEFAULT 19.00,
  is_billable boolean DEFAULT true NOT NULL,
  vendor_name text,
  invoice_number text,
  invoice_date date,
  description text NOT NULL,
  category text,
  document_id uuid,
  notes text,
  meta_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.event_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  actor_id uuid,
  entity text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  detail_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.facility_tickets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  object_id uuid,
  unit_id uuid,
  ticket_number text NOT NULL,
  title text NOT NULL,
  description text,
  priority facility_ticket_priority DEFAULT 'normal'::facility_ticket_priority NOT NULL,
  status facility_ticket_status DEFAULT 'open'::facility_ticket_status NOT NULL,
  reporter_id uuid,
  assignee_id uuid,
  category text,
  location text,
  due_date timestamp with time zone,
  resolved_at timestamp with time zone,
  closed_at timestamp with time zone,
  estimated_hours numeric,
  actual_hours numeric,
  cost_estimate numeric,
  actual_cost numeric,
  meta_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.object_owners (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  object_id uuid NOT NULL,
  person_id uuid NOT NULL,
  is_main_owner boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.objects (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  address text,
  has_central_heating boolean DEFAULT false,
  description text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  object_number text,
  verw_art verw_art,
  aufgaben_aktiv boolean DEFAULT true,
  personen_erfassung boolean DEFAULT false,
  zaehler_erfassung boolean DEFAULT false,
  verwaltungsbeirat boolean DEFAULT false,
  holiday_country text DEFAULT 'DE'::text,
  holiday_region text,
  parent_object_id uuid,
  object_type object_type DEFAULT 'anlage'::object_type,
  is_multi_building boolean DEFAULT false,
  is_active boolean DEFAULT true,
  sub_number text,
  street text,
  postal_code text,
  city text,
  street_number text,
  has_locking_system boolean DEFAULT false,
  locking_card_number text,
  locking_card_location text,
  heating_type text,
  heating_fuel_oil boolean DEFAULT false,
  heating_fuel_gas boolean DEFAULT false,
  heating_fuel_pellets boolean DEFAULT false,
  heating_fuel_electric boolean DEFAULT false,
  has_elevator boolean DEFAULT false,
  has_lifting_system boolean DEFAULT false,
  has_drainage_system boolean DEFAULT false,
  has_rwa_system boolean DEFAULT false,
  has_solar_system boolean DEFAULT false,
  has_photovoltaic_system boolean DEFAULT false,
  has_septic_tank boolean DEFAULT false,
  other_technical_equipment text,
  has_ventilation_system boolean DEFAULT false,
  has_fire_dampers boolean DEFAULT false,
  has_sprinkler_system boolean DEFAULT false,
  has_fire_alarm_system boolean DEFAULT false,
  has_chp_unit boolean DEFAULT false,
  has_oil_therme boolean DEFAULT false,
  has_gas_therme boolean DEFAULT false,
  has_pellet_stove boolean DEFAULT false,
  has_battery_storage boolean DEFAULT false,
  has_automatic_doors boolean DEFAULT false,
  has_roller_shutters boolean DEFAULT false,
  hot_water_supply_type text,
  hot_water_has_heat_exchanger boolean DEFAULT false,
  verwalter_person_id uuid,
  is_mock_data boolean DEFAULT false NOT NULL,
  building_position text,
  party_count_override integer,
  shared_facilities text[],
  rent_account_iban text,
  rent_account_bic text,
  rent_account_bank_name text,
  rent_account_holder text,
  energy_certificate_type text,
  energy_certificate_valid_until date,
  energy_certificate_document_id uuid,
  mea_total numeric(12,4),
  billing_basis text,
  latitude double precision,
  longitude double precision,
  geocoded_at timestamp with time zone,
  rent_cap_area boolean,
  publicly_subsidized boolean DEFAULT false NOT NULL,
  heating_info_channel text,
  energy_certificate_registration_number text,
  sepa_creditor_id text,
  monument_protected boolean DEFAULT false NOT NULL
);

CREATE TABLE public.occupancy_tenants (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  occupancy_id uuid NOT NULL,
  person_id uuid NOT NULL,
  is_main_tenant boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.ownership_owners (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  ownership_id uuid NOT NULL,
  person_id uuid NOT NULL,
  is_main_owner boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.person_objects (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  person_id uuid NOT NULL,
  object_id uuid NOT NULL,
  relationship_types person_object_role[] DEFAULT '{}'::person_object_role[],
  start_date date,
  end_date date,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  sub_object_id uuid
);

CREATE TABLE public.persons (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  person_type person_type,
  salutation text,
  title text,
  first_name text NOT NULL,
  last_name text NOT NULL,
  birth_date date,
  email text,
  phone text,
  mobile text,
  street text,
  house_number text,
  postal_code text,
  city text,
  country text DEFAULT 'Deutschland'::text,
  iban text,
  bic text,
  bank_name text,
  tax_id text,
  company_name text,
  notes text,
  is_active boolean DEFAULT true,
  meta_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  commercial_register_number text,
  messenger_type text,
  messenger_number text,
  previous_street text,
  previous_house_number text,
  previous_postal_code text,
  previous_city text,
  previous_country text DEFAULT 'Deutschland'::text,
  gdpr_email_consent boolean DEFAULT false,
  gdpr_phone_consent boolean DEFAULT false,
  gdpr_messenger_consent boolean DEFAULT false,
  gdpr_consent_date date,
  spouse_person_id uuid,
  relationship_type text,
  bank_account_holder text,
  ausweisbild_pfad text,
  ausweisbild_datum timestamp with time zone,
  sepa_creditor_id text,
  hide_contact_details boolean DEFAULT false NOT NULL,
  roles text[] DEFAULT '{}'::text[] NOT NULL,
  legal_form text
);

CREATE TABLE public.platform_admins (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  email text NOT NULL,
  name text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  abbreviation text,
  meta_json jsonb DEFAULT '{}'::jsonb,
  avatar_url text
);

CREATE TABLE public.role_permissions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  role text NOT NULL,
  permission text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.saas_modules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  category text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  sort_order integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  is_core boolean DEFAULT false NOT NULL,
  price_monthly numeric(12,2) DEFAULT 0 NOT NULL,
  price_yearly numeric(12,2) DEFAULT 0 NOT NULL,
  visibility_default text DEFAULT 'tenant_admin'::text NOT NULL,
  allowed_plan_min text DEFAULT 'basic'::text,
  pricing_mode text DEFAULT 'flat'::text,
  unit_label text,
  default_unit_price_cents integer DEFAULT 0,
  is_beta boolean DEFAULT false,
  beta_label text,
  parent_module_id uuid
);

CREATE TABLE public.service_orders (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  business_unit_id uuid,
  order_no text NOT NULL,
  object_id uuid NOT NULL,
  unit_id uuid,
  person_id uuid,
  order_type text,
  status service_order_status DEFAULT 'draft'::service_order_status,
  auto_created boolean DEFAULT false,
  title text,
  description text,
  scheduled_date date,
  completed_date date,
  created_by uuid NOT NULL,
  assigned_to uuid,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.tasks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  object_id uuid NOT NULL,
  task_category_id uuid NOT NULL,
  vsm_id uuid,
  title text NOT NULL,
  status_id uuid,
  assignee_id uuid,
  start_date timestamp with time zone,
  due_date timestamp with time zone,
  completed_at timestamp with time zone,
  priority task_priority DEFAULT 'normal'::task_priority,
  meta_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  task_code text,
  progress_points integer DEFAULT 0,
  notes text,
  parent_task_id uuid,
  planning_year integer NOT NULL
);

CREATE TABLE public.tenant_limits (
  tenant_id uuid NOT NULL,
  limit_key text NOT NULL,
  max_value integer NOT NULL,
  current_value integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  limit_value numeric,
  enforcement text DEFAULT 'hard'::text,
  effective_from date DEFAULT CURRENT_DATE,
  effective_to date
);

CREATE TABLE public.tenant_usage_counters (
  tenant_id uuid NOT NULL,
  counter_key text NOT NULL,
  period text NOT NULL,
  value integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.tenants (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  logo_url text,
  theme_json jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  commission_share_percent numeric DEFAULT 50,
  payout_method text DEFAULT 'platform'::text,
  payout_iban text,
  payout_account_holder text,
  payout_cycle text DEFAULT 'monthly'::text,
  street text,
  house_number text,
  postal_code text,
  city text,
  country text DEFAULT 'Deutschland'::text,
  phone text,
  email text,
  fax text,
  tax_id text,
  commercial_register_number text,
  commercial_register_court text,
  managing_director text,
  bank_name text,
  bic text,
  sepa_creditor_id text,
  business_type business_type,
  business_type_id uuid,
  stripe_customer_id text
);

CREATE TABLE public.unit_occupancies (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  tenant_person_id uuid NOT NULL,
  start_date date NOT NULL,
  end_date date,
  base_rent numeric,
  additional_costs numeric,
  heating_costs numeric,
  total_rent numeric,
  deposit numeric,
  contract_id uuid,
  payment_day integer DEFAULT 1,
  notice_period_months integer DEFAULT 3,
  handover_in_protocol_id uuid,
  handover_out_protocol_id uuid,
  notes text,
  meta_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  tenant_number text,
  tenant_number_old text,
  followup_street text,
  followup_house_number text,
  followup_postal_code text,
  followup_city text,
  followup_country text DEFAULT 'Deutschland'::text,
  followup_email text,
  followup_phone text,
  garage_costs numeric DEFAULT 0,
  other_costs numeric DEFAULT 0
);

CREATE TABLE public.unit_ownerships (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  owner_person_id uuid NOT NULL,
  start_date date NOT NULL,
  end_date date,
  ownership_type text,
  share_percentage numeric,
  notes text,
  meta_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  owner_number text,
  owner_number_old text,
  followup_street text,
  followup_house_number text,
  followup_postal_code text,
  followup_city text,
  followup_country text DEFAULT 'Deutschland'::text,
  followup_email text,
  followup_phone text
);

CREATE TABLE public.units (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  object_id uuid NOT NULL,
  unit_number text NOT NULL,
  unit_type unit_type DEFAULT 'apartment'::unit_type NOT NULL,
  floor integer,
  living_area numeric(8,2),
  total_area numeric(8,2),
  rooms numeric(3,1),
  has_balcony boolean DEFAULT false,
  has_garden boolean DEFAULT false,
  has_elevator boolean DEFAULT false,
  has_parking boolean DEFAULT false,
  is_available boolean DEFAULT true,
  available_from date,
  description text,
  equipment_notes text,
  notes text,
  meta_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  sub_object_id uuid,
  floor_number integer,
  floor_type text,
  floor_position_number integer,
  floor_position_side text,
  has_terrace boolean DEFAULT false,
  has_basement boolean DEFAULT false,
  basement_number text,
  has_garage boolean DEFAULT false,
  garage_number text,
  parking_number text,
  "position" text,
  verwalter_person_id uuid,
  is_mock_data boolean DEFAULT false NOT NULL,
  is_full_floor boolean DEFAULT false NOT NULL,
  mea_numerator numeric(12,4),
  parking_kind text,
  garden_designation text,
  building_position text,
  living_area_basis text,
  has_shower boolean DEFAULT false NOT NULL,
  has_bathtub boolean DEFAULT false NOT NULL,
  apartment_type text
);

CREATE TABLE public.user_permissions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  permission text NOT NULL,
  granted_by uuid,
  granted_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.user_roles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  role app_role NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- 3. Primärschlüssel, Unique, Check
ALTER TABLE public.business_partner_contacts ADD CONSTRAINT business_partner_contacts_pkey PRIMARY KEY (id);
ALTER TABLE public.business_partner_locations ADD CONSTRAINT business_partner_locations_pkey PRIMARY KEY (id);
ALTER TABLE public.business_partner_objects ADD CONSTRAINT business_partner_objects_pkey PRIMARY KEY (id);
ALTER TABLE public.business_partners ADD CONSTRAINT business_partners_pkey PRIMARY KEY (id);
ALTER TABLE public.company_persons ADD CONSTRAINT company_persons_pkey PRIMARY KEY (id);
ALTER TABLE public.cost_entries ADD CONSTRAINT cost_entries_pkey PRIMARY KEY (id);
ALTER TABLE public.event_logs ADD CONSTRAINT event_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.facility_tickets ADD CONSTRAINT facility_tickets_pkey PRIMARY KEY (id);
ALTER TABLE public.object_owners ADD CONSTRAINT object_owners_pkey PRIMARY KEY (id);
ALTER TABLE public.objects ADD CONSTRAINT objects_pkey PRIMARY KEY (id);
ALTER TABLE public.occupancy_tenants ADD CONSTRAINT occupancy_tenants_pkey PRIMARY KEY (id);
ALTER TABLE public.ownership_owners ADD CONSTRAINT ownership_owners_pkey PRIMARY KEY (id);
ALTER TABLE public.person_objects ADD CONSTRAINT person_objects_pkey PRIMARY KEY (id);
ALTER TABLE public.persons ADD CONSTRAINT persons_pkey PRIMARY KEY (id);
ALTER TABLE public.platform_admins ADD CONSTRAINT platform_admins_pkey PRIMARY KEY (id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);
ALTER TABLE public.saas_modules ADD CONSTRAINT saas_modules_pkey PRIMARY KEY (id);
ALTER TABLE public.service_orders ADD CONSTRAINT service_orders_pkey PRIMARY KEY (id);
ALTER TABLE public.tasks ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);
ALTER TABLE public.tenant_limits ADD CONSTRAINT tenant_limits_pkey PRIMARY KEY (tenant_id, limit_key);
ALTER TABLE public.tenant_usage_counters ADD CONSTRAINT tenant_usage_counters_pkey PRIMARY KEY (tenant_id, counter_key, period);
ALTER TABLE public.tenants ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);
ALTER TABLE public.unit_occupancies ADD CONSTRAINT unit_occupancies_pkey PRIMARY KEY (id);
ALTER TABLE public.unit_ownerships ADD CONSTRAINT unit_ownerships_pkey PRIMARY KEY (id);
ALTER TABLE public.units ADD CONSTRAINT units_pkey PRIMARY KEY (id);
ALTER TABLE public.user_permissions ADD CONSTRAINT user_permissions_pkey PRIMARY KEY (id);
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
ALTER TABLE public.business_partner_objects ADD CONSTRAINT business_partner_objects_business_partner_id_object_id_rela_key UNIQUE (business_partner_id, object_id, relationship_type);
ALTER TABLE public.company_persons ADD CONSTRAINT company_persons_unique UNIQUE (company_id, person_id);
ALTER TABLE public.facility_tickets ADD CONSTRAINT facility_tickets_tenant_id_ticket_number_key UNIQUE (tenant_id, ticket_number);
ALTER TABLE public.object_owners ADD CONSTRAINT object_owners_unique UNIQUE (object_id, person_id);
ALTER TABLE public.objects ADD CONSTRAINT objects_object_number_sub_number_tenant_id_key UNIQUE (object_number, sub_number, tenant_id);
ALTER TABLE public.occupancy_tenants ADD CONSTRAINT occupancy_tenants_unique UNIQUE (occupancy_id, person_id);
ALTER TABLE public.ownership_owners ADD CONSTRAINT ownership_owners_unique UNIQUE (ownership_id, person_id);
ALTER TABLE public.person_objects ADD CONSTRAINT person_objects_person_id_object_id_key UNIQUE (person_id, object_id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_tenant_id_email_key UNIQUE (tenant_id, email);
ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_role_permission_key UNIQUE (role, permission);
ALTER TABLE public.saas_modules ADD CONSTRAINT saas_modules_key_key UNIQUE (key);
ALTER TABLE public.saas_modules ADD CONSTRAINT saas_modules_key_unique UNIQUE (key);
ALTER TABLE public.service_orders ADD CONSTRAINT service_orders_order_no_key UNIQUE (order_no);
ALTER TABLE public.tasks ADD CONSTRAINT unique_task_identifier UNIQUE (object_id, task_code, planning_year, tenant_id);
ALTER TABLE public.unit_occupancies ADD CONSTRAINT unit_occupancies_tenant_number_unique UNIQUE (tenant_id, tenant_number);
ALTER TABLE public.unit_ownerships ADD CONSTRAINT unit_ownerships_owner_number_unique UNIQUE (tenant_id, owner_number);
ALTER TABLE public.units ADD CONSTRAINT units_object_unit_number_unique UNIQUE (object_id, unit_number);
ALTER TABLE public.user_permissions ADD CONSTRAINT user_permissions_user_id_tenant_id_permission_key UNIQUE (user_id, tenant_id, permission);
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_tenant_id_role_key UNIQUE (user_id, tenant_id, role);
ALTER TABLE public.company_persons ADD CONSTRAINT company_persons_not_self CHECK ((company_id <> person_id));
ALTER TABLE public.company_persons ADD CONSTRAINT company_persons_role_check CHECK ((company_role = ANY (ARRAY['geschaeftsfuehrer'::text, 'prokurist'::text, 'mitarbeiter'::text])));
ALTER TABLE public.objects ADD CONSTRAINT check_no_self_reference CHECK (((parent_object_id IS NULL) OR (parent_object_id <> id)));
ALTER TABLE public.objects ADD CONSTRAINT objects_billing_basis_check CHECK (((billing_basis IS NULL) OR (billing_basis = ANY (ARRAY['wohnflaeche'::text, 'mea'::text]))));
ALTER TABLE public.objects ADD CONSTRAINT objects_billing_basis_requires_wohnungseigentum CHECK (((billing_basis IS DISTINCT FROM 'mea'::text) OR ((verw_art IS NOT NULL) AND (verw_art = ANY (ARRAY['WEG'::verw_art, 'SMV'::verw_art])))));
ALTER TABLE public.objects ADD CONSTRAINT objects_building_position_check CHECK (((building_position IS NULL) OR (building_position = ANY (ARRAY['vorderhaus'::text, 'mittelgebaeude'::text, 'rueckgebaeude'::text, 'seitenfluegel'::text, 'einzelgebaeude'::text]))));
ALTER TABLE public.objects ADD CONSTRAINT objects_energy_certificate_type_check CHECK ((energy_certificate_type = ANY (ARRAY['verbrauch'::text, 'bedarf'::text])));
ALTER TABLE public.objects ADD CONSTRAINT objects_holiday_country_check CHECK ((holiday_country = ANY (ARRAY['DE'::text, 'AT'::text, 'CH'::text])));
ALTER TABLE public.objects ADD CONSTRAINT objects_hot_water_supply_type_check CHECK ((hot_water_supply_type = ANY (ARRAY['zentral'::text, 'dezentral'::text])));
ALTER TABLE public.objects ADD CONSTRAINT objects_latitude_range CHECK (((latitude IS NULL) OR ((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision))));
ALTER TABLE public.objects ADD CONSTRAINT objects_longitude_range CHECK (((longitude IS NULL) OR ((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision))));
ALTER TABLE public.objects ADD CONSTRAINT objects_mea_total_check CHECK ((mea_total > (0)::numeric));
ALTER TABLE public.objects ADD CONSTRAINT objects_party_count_override_check CHECK ((party_count_override > 0));
ALTER TABLE public.objects ADD CONSTRAINT objects_shared_facilities_check CHECK ((shared_facilities <@ ARRAY['waschkueche'::text, 'trockenraum'::text, 'fahrradkeller'::text, 'speicher'::text, 'hof'::text, 'garten'::text, 'muellraum'::text, 'aufzug'::text]));
ALTER TABLE public.persons ADD CONSTRAINT persons_roles_check CHECK ((roles <@ ARRAY['mieter'::text, 'eigentuemer'::text, 'verwalter'::text, 'dienstleister'::text, 'sonstiges'::text]));
ALTER TABLE public.platform_admins ADD CONSTRAINT platform_admins_role_check CHECK ((role = ANY (ARRAY['platform_owner'::text, 'platform_admin'::text, 'platform_support'::text])));
ALTER TABLE public.saas_modules ADD CONSTRAINT saas_modules_category_check CHECK ((category = ANY (ARRAY['core'::text, 'business'::text, 'addon'::text])));
ALTER TABLE public.saas_modules ADD CONSTRAINT saas_modules_pricing_mode_check CHECK ((pricing_mode = ANY (ARRAY['per_user'::text, 'flat'::text, 'usage'::text, 'hybrid'::text])));
ALTER TABLE public.saas_modules ADD CONSTRAINT saas_modules_visibility_check CHECK ((visibility_default = ANY (ARRAY['tenant_admin'::text, 'all'::text, 'hidden'::text])));
ALTER TABLE public.tasks ADD CONSTRAINT tasks_progress_points_check CHECK (((progress_points >= 0) AND (progress_points <= 100)));
ALTER TABLE public.tenant_limits ADD CONSTRAINT tenant_limits_enforcement_check CHECK ((enforcement = ANY (ARRAY['soft'::text, 'hard'::text])));
ALTER TABLE public.tenants ADD CONSTRAINT tenants_commission_share_percent_check CHECK (((commission_share_percent >= (0)::numeric) AND (commission_share_percent <= (100)::numeric)));
ALTER TABLE public.units ADD CONSTRAINT units_apartment_type_check CHECK (((apartment_type IS NULL) OR (apartment_type = ANY (ARRAY['etagenwohnung'::text, 'wohnung'::text, 'apartment'::text]))));
ALTER TABLE public.units ADD CONSTRAINT units_floor_position_side_check CHECK (((floor_position_side IS NULL) OR ((btrim(floor_position_side) <> ''::text) AND (char_length(floor_position_side) <= 60))));
ALTER TABLE public.units ADD CONSTRAINT units_floor_type_check CHECK ((floor_type = ANY (ARRAY['UG'::text, 'EG'::text, 'OG'::text, 'DG'::text])));
ALTER TABLE public.units ADD CONSTRAINT units_mea_numerator_check CHECK ((mea_numerator >= (0)::numeric));
ALTER TABLE public.units ADD CONSTRAINT units_parking_kind_check CHECK ((parking_kind = ANY (ARRAY['stellplatz'::text, 'tiefgarage'::text, 'garage'::text, 'carport'::text])));

-- 4. Eindeutige Indizes
CREATE UNIQUE INDEX ux_platform_admins_user_id ON public.platform_admins USING btree (user_id);
CREATE UNIQUE INDEX tenants_stripe_customer_id_key ON public.tenants USING btree (stripe_customer_id) WHERE (stripe_customer_id IS NOT NULL);

-- 5. Fremdschlüssel (nur innerhalb dieses Basisschemas und auf auth.users)
ALTER TABLE public.business_partner_contacts ADD CONSTRAINT business_partner_contacts_business_partner_id_fkey FOREIGN KEY (business_partner_id) REFERENCES business_partners(id) ON DELETE CASCADE;
ALTER TABLE public.business_partner_contacts ADD CONSTRAINT business_partner_contacts_location_id_fkey FOREIGN KEY (location_id) REFERENCES business_partner_locations(id) ON DELETE CASCADE;
ALTER TABLE public.business_partner_contacts ADD CONSTRAINT business_partner_contacts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.business_partner_locations ADD CONSTRAINT business_partner_locations_business_partner_id_fkey FOREIGN KEY (business_partner_id) REFERENCES business_partners(id) ON DELETE CASCADE;
ALTER TABLE public.business_partner_locations ADD CONSTRAINT business_partner_locations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.business_partner_objects ADD CONSTRAINT business_partner_objects_business_partner_id_fkey FOREIGN KEY (business_partner_id) REFERENCES business_partners(id) ON DELETE CASCADE;
ALTER TABLE public.business_partner_objects ADD CONSTRAINT business_partner_objects_object_id_fkey FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE;
ALTER TABLE public.business_partner_objects ADD CONSTRAINT business_partner_objects_sub_object_id_fkey FOREIGN KEY (sub_object_id) REFERENCES objects(id) ON DELETE SET NULL;
ALTER TABLE public.business_partner_objects ADD CONSTRAINT business_partner_objects_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.business_partners ADD CONSTRAINT business_partners_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.company_persons ADD CONSTRAINT company_persons_company_id_fkey FOREIGN KEY (company_id) REFERENCES persons(id) ON DELETE CASCADE;
ALTER TABLE public.company_persons ADD CONSTRAINT company_persons_person_id_fkey FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE;
ALTER TABLE public.company_persons ADD CONSTRAINT company_persons_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.cost_entries ADD CONSTRAINT cost_entries_object_id_fkey FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE;
ALTER TABLE public.cost_entries ADD CONSTRAINT cost_entries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.event_logs ADD CONSTRAINT event_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.event_logs ADD CONSTRAINT event_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.facility_tickets ADD CONSTRAINT facility_tickets_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.facility_tickets ADD CONSTRAINT facility_tickets_object_id_fkey FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE SET NULL;
ALTER TABLE public.facility_tickets ADD CONSTRAINT facility_tickets_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.facility_tickets ADD CONSTRAINT facility_tickets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.facility_tickets ADD CONSTRAINT facility_tickets_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE public.object_owners ADD CONSTRAINT object_owners_object_id_fkey FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE;
ALTER TABLE public.object_owners ADD CONSTRAINT object_owners_person_id_fkey FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE;
ALTER TABLE public.object_owners ADD CONSTRAINT object_owners_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE public.objects ADD CONSTRAINT objects_parent_object_id_fkey FOREIGN KEY (parent_object_id) REFERENCES objects(id) ON DELETE CASCADE;
ALTER TABLE public.objects ADD CONSTRAINT objects_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.objects ADD CONSTRAINT objects_verwalter_person_id_fkey FOREIGN KEY (verwalter_person_id) REFERENCES persons(id) ON DELETE SET NULL;
ALTER TABLE public.occupancy_tenants ADD CONSTRAINT occupancy_tenants_occupancy_id_fkey FOREIGN KEY (occupancy_id) REFERENCES unit_occupancies(id) ON DELETE CASCADE;
ALTER TABLE public.occupancy_tenants ADD CONSTRAINT occupancy_tenants_person_id_fkey FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE;
ALTER TABLE public.occupancy_tenants ADD CONSTRAINT occupancy_tenants_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE public.ownership_owners ADD CONSTRAINT ownership_owners_ownership_id_fkey FOREIGN KEY (ownership_id) REFERENCES unit_ownerships(id) ON DELETE CASCADE;
ALTER TABLE public.ownership_owners ADD CONSTRAINT ownership_owners_person_id_fkey FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE;
ALTER TABLE public.ownership_owners ADD CONSTRAINT ownership_owners_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE public.person_objects ADD CONSTRAINT person_objects_object_id_fkey FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE;
ALTER TABLE public.person_objects ADD CONSTRAINT person_objects_person_id_fkey FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE;
ALTER TABLE public.person_objects ADD CONSTRAINT person_objects_sub_object_id_fkey FOREIGN KEY (sub_object_id) REFERENCES objects(id) ON DELETE SET NULL;
ALTER TABLE public.person_objects ADD CONSTRAINT person_objects_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.persons ADD CONSTRAINT persons_spouse_person_id_fkey FOREIGN KEY (spouse_person_id) REFERENCES persons(id) ON DELETE SET NULL;
ALTER TABLE public.persons ADD CONSTRAINT persons_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.saas_modules ADD CONSTRAINT saas_modules_parent_module_id_fkey FOREIGN KEY (parent_module_id) REFERENCES saas_modules(id) ON DELETE SET NULL;
ALTER TABLE public.service_orders ADD CONSTRAINT service_orders_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.service_orders ADD CONSTRAINT service_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.service_orders ADD CONSTRAINT service_orders_object_id_fkey FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE;
ALTER TABLE public.service_orders ADD CONSTRAINT service_orders_person_id_fkey FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE SET NULL;
ALTER TABLE public.service_orders ADD CONSTRAINT service_orders_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.service_orders ADD CONSTRAINT service_orders_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_object_id_fkey FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_parent_task_id_fkey FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.unit_occupancies ADD CONSTRAINT unit_occupancies_tenant_person_id_fkey FOREIGN KEY (tenant_person_id) REFERENCES persons(id) ON DELETE CASCADE;
ALTER TABLE public.unit_occupancies ADD CONSTRAINT unit_occupancies_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE;
ALTER TABLE public.unit_ownerships ADD CONSTRAINT unit_ownerships_owner_person_id_fkey FOREIGN KEY (owner_person_id) REFERENCES persons(id) ON DELETE CASCADE;
ALTER TABLE public.unit_ownerships ADD CONSTRAINT unit_ownerships_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE;
ALTER TABLE public.units ADD CONSTRAINT units_object_id_fkey FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE;
ALTER TABLE public.units ADD CONSTRAINT units_sub_object_id_fkey FOREIGN KEY (sub_object_id) REFERENCES objects(id) ON DELETE SET NULL;
ALTER TABLE public.units ADD CONSTRAINT units_verwalter_person_id_fkey FOREIGN KEY (verwalter_person_id) REFERENCES persons(id) ON DELETE SET NULL;
ALTER TABLE public.user_permissions ADD CONSTRAINT user_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id);
ALTER TABLE public.user_permissions ADD CONSTRAINT user_permissions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.user_permissions ADD CONSTRAINT user_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 6. Hilfsfunktionen (unverändert aus RealesOS)
CREATE OR REPLACE FUNCTION public.get_user_tenant_id(_user_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT tenant_id
  FROM public.profiles
  WHERE id = _user_id
  LIMIT 1
$function$
;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _tenant_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND tenant_id = _tenant_id
      AND role = _role
  )
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.user_has_permission(p_user_id uuid, p_tenant_id uuid, p_permission text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  has_perm BOOLEAN := false;
BEGIN
  IF p_user_id != (select auth.uid()) AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Keine Berechtigung, die Rechte anderer Nutzer zu prüfen' USING ERRCODE = 'P0001';
  END IF;

  -- Check direct user permission
  SELECT EXISTS (
    SELECT 1 FROM public.user_permissions
    WHERE user_id = p_user_id
    AND tenant_id = p_tenant_id
    AND permission = p_permission
  ) INTO has_perm;

  IF has_perm THEN
    RETURN true;
  END IF;

  -- Check role-based permission
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role = ur.role::text
    WHERE ur.user_id = p_user_id
    AND ur.tenant_id = p_tenant_id
    AND rp.permission = p_permission
  ) INTO has_perm;

  RETURN has_perm;
END;
$function$
;

-- 6a. NUR FÜR DIE LOKALE ENTWICKLUNG — Ersatz für public.get_active_modules.
--     Das Original wertet Planvarianten, Overrides und Scopes aus (in RealesOS vorhanden).
--     Dieser Ersatz meldet jedes aktive Modul als freigeschaltet, damit
--     ProtectedModuleRoute lokal funktioniert. Wird bei der Integration NICHT übernommen.
CREATE OR REPLACE FUNCTION public.get_active_modules(p_tenant_id uuid)
RETURNS TABLE(module_id uuid, module_key text, module_name text, is_core boolean, effective_state text, source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT sm.id, sm.key, sm.name, sm.is_core, 'include'::text, 'dev_stub'::text
  FROM public.saas_modules sm
  WHERE sm.is_active
    AND p_tenant_id = public.get_user_tenant_id((select auth.uid()));
$$;
REVOKE EXECUTE ON FUNCTION public.get_active_modules(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_modules(uuid) TO authenticated, service_role;

-- 7. Row Level Security
ALTER TABLE public.business_partner_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_partner_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_partner_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.object_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.occupancy_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ownership_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_usage_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_occupancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_ownerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 8. Policies (unverändert aus RealesOS)
CREATE POLICY "Admins and Mitarbeiter can manage contacts" ON public.business_partner_contacts AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))) AND (has_role(( SELECT auth.uid() AS uid), tenant_id, 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), tenant_id, 'mitarbeiter'::app_role))));
CREATE POLICY "Users can view contacts in own tenant" ON public.business_partner_contacts AS PERMISSIVE FOR SELECT TO public
  USING ((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))));
CREATE POLICY "Admins and Mitarbeiter can manage locations" ON public.business_partner_locations AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))) AND (has_role(( SELECT auth.uid() AS uid), tenant_id, 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), tenant_id, 'mitarbeiter'::app_role))));
CREATE POLICY "Users can view locations in own tenant" ON public.business_partner_locations AS PERMISSIVE FOR SELECT TO public
  USING ((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))));
CREATE POLICY "Admins and Mitarbeiter can manage partner objects" ON public.business_partner_objects AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))) AND (has_role(( SELECT auth.uid() AS uid), tenant_id, 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), tenant_id, 'mitarbeiter'::app_role))));
CREATE POLICY "Users can view partner objects in own tenant" ON public.business_partner_objects AS PERMISSIVE FOR SELECT TO public
  USING ((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))));
CREATE POLICY "Admins and Mitarbeiter can manage partners" ON public.business_partners AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))) AND (has_role(( SELECT auth.uid() AS uid), tenant_id, 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), tenant_id, 'mitarbeiter'::app_role))));
CREATE POLICY "Users can view partners in own tenant" ON public.business_partners AS PERMISSIVE FOR SELECT TO public
  USING ((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))));
CREATE POLICY "Admins and Mitarbeiter can manage company_persons" ON public.company_persons AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))) AND (has_role(( SELECT auth.uid() AS uid), tenant_id, 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), tenant_id, 'mitarbeiter'::app_role))))
  WITH CHECK (((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))) AND (has_role(( SELECT auth.uid() AS uid), tenant_id, 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), tenant_id, 'mitarbeiter'::app_role))));
CREATE POLICY "Users can view company_persons in own tenant" ON public.company_persons AS PERMISSIVE FOR SELECT TO public
  USING ((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))));
CREATE POLICY "Admins and Mitarbeiter can manage cost entries" ON public.cost_entries AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))) AND (has_role(( SELECT auth.uid() AS uid), tenant_id, 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), tenant_id, 'mitarbeiter'::app_role))))
  WITH CHECK (((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))) AND (has_role(( SELECT auth.uid() AS uid), tenant_id, 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), tenant_id, 'mitarbeiter'::app_role))));
CREATE POLICY "Users can view cost entries in own tenant" ON public.cost_entries AS PERMISSIVE FOR SELECT TO public
  USING ((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))));
CREATE POLICY "System can insert event logs" ON public.event_logs AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((tenant_id = get_user_tenant_id(auth.uid())));
CREATE POLICY "Users can view event logs in own tenant" ON public.event_logs AS PERMISSIVE FOR SELECT TO public
  USING ((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))));
CREATE POLICY "Admins and Mitarbeiter can create tickets" ON public.facility_tickets AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((tenant_id = get_user_tenant_id(auth.uid())) AND (has_role(auth.uid(), tenant_id, 'admin'::app_role) OR has_role(auth.uid(), tenant_id, 'mitarbeiter'::app_role))));
CREATE POLICY "Admins can delete tickets" ON public.facility_tickets AS PERMISSIVE FOR DELETE TO public
  USING (((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))) AND has_role(( SELECT auth.uid() AS uid), tenant_id, 'admin'::app_role)));
CREATE POLICY "Admins, Mitarbeiter and Facility can update tickets" ON public.facility_tickets AS PERMISSIVE FOR UPDATE TO public
  USING (((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))) AND (has_role(( SELECT auth.uid() AS uid), tenant_id, 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), tenant_id, 'mitarbeiter'::app_role) OR has_role(( SELECT auth.uid() AS uid), tenant_id, 'facility'::app_role))));
CREATE POLICY "Users can view tickets in own tenant" ON public.facility_tickets AS PERMISSIVE FOR SELECT TO public
  USING ((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))));
CREATE POLICY "Admins and Mitarbeiter can manage object owners" ON public.object_owners AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id(auth.uid())) AND (has_role(auth.uid(), tenant_id, 'admin'::app_role) OR has_role(auth.uid(), tenant_id, 'mitarbeiter'::app_role))));
CREATE POLICY "Users can view object owners in own tenant" ON public.object_owners AS PERMISSIVE FOR SELECT TO public
  USING ((tenant_id = get_user_tenant_id(auth.uid())));
CREATE POLICY "Admins and Mitarbeiter can insert objects" ON public.objects AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) AND (has_role(auth.uid(), tenant_id, 'admin'::app_role) OR has_role(auth.uid(), tenant_id, 'mitarbeiter'::app_role))));
CREATE POLICY "Admins and Mitarbeiter can update objects" ON public.objects AS PERMISSIVE FOR UPDATE TO public
  USING (((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid)))) AND (has_role(( SELECT auth.uid() AS uid), tenant_id, 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), tenant_id, 'mitarbeiter'::app_role))));
CREATE POLICY "Admins can delete objects" ON public.objects AS PERMISSIVE FOR DELETE TO public
  USING (((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid)))) AND has_role(( SELECT auth.uid() AS uid), tenant_id, 'admin'::app_role)));
CREATE POLICY "Users can view objects in own tenant" ON public.objects AS PERMISSIVE FOR SELECT TO public
  USING ((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))));
CREATE POLICY "Admins and Mitarbeiter can manage occupancy tenants" ON public.occupancy_tenants AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))) AND (has_role(( SELECT auth.uid() AS uid), tenant_id, 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), tenant_id, 'mitarbeiter'::app_role))));
CREATE POLICY "Users can view occupancy tenants in own tenant" ON public.occupancy_tenants AS PERMISSIVE FOR SELECT TO public
  USING ((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))));
CREATE POLICY "Admins and Mitarbeiter can manage ownership owners" ON public.ownership_owners AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))) AND (has_role(( SELECT auth.uid() AS uid), tenant_id, 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), tenant_id, 'mitarbeiter'::app_role))));
CREATE POLICY "Users can view ownership owners in own tenant" ON public.ownership_owners AS PERMISSIVE FOR SELECT TO public
  USING ((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))));
CREATE POLICY "Admins and Mitarbeiter can manage person objects" ON public.person_objects AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))) AND (has_role(( SELECT auth.uid() AS uid), tenant_id, 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), tenant_id, 'mitarbeiter'::app_role))));
CREATE POLICY "Users can view person objects in own tenant" ON public.person_objects AS PERMISSIVE FOR SELECT TO public
  USING ((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))));
CREATE POLICY "Admins and Mitarbeiter can manage persons" ON public.persons AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))) AND (has_role(( SELECT auth.uid() AS uid), tenant_id, 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), tenant_id, 'mitarbeiter'::app_role))));
CREATE POLICY "Users can view persons in own tenant" ON public.persons AS PERMISSIVE FOR SELECT TO public
  USING ((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))));
CREATE POLICY "Users can insert own profile" ON public.profiles AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((id = auth.uid()));
CREATE POLICY "Users can update own profile" ON public.profiles AS PERMISSIVE FOR UPDATE TO public
  USING ((id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Users can view own profile" ON public.profiles AS PERMISSIVE FOR SELECT TO public
  USING ((id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Users can view profiles in same tenant" ON public.profiles AS PERMISSIVE FOR SELECT TO public
  USING ((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))));
CREATE POLICY "Authenticated users can view role permissions" ON public.role_permissions AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Anyone can read saas_modules" ON public.saas_modules AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY tenant_isolation ON public.service_orders AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "Admins can delete tasks" ON public.tasks AS PERMISSIVE FOR DELETE TO public
  USING (((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid)))) AND has_role(( SELECT auth.uid() AS uid), tenant_id, 'admin'::app_role)));
CREATE POLICY "Users can insert tasks in own tenant" ON public.tasks AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((tenant_id = get_user_tenant_id(auth.uid())));
CREATE POLICY "Users can update tasks in own tenant" ON public.tasks AS PERMISSIVE FOR UPDATE TO public
  USING ((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))));
CREATE POLICY "Users can view tasks in own tenant" ON public.tasks AS PERMISSIVE FOR SELECT TO public
  USING ((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))));
CREATE POLICY "Admins can update own tenant" ON public.tenants AS PERMISSIVE FOR UPDATE TO public
  USING (((id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid)))) AND has_role(( SELECT auth.uid() AS uid), id, 'admin'::app_role)));
CREATE POLICY "Admins and Mitarbeiter can manage occupancies" ON public.unit_occupancies AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))) AND (has_role(( SELECT auth.uid() AS uid), tenant_id, 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), tenant_id, 'mitarbeiter'::app_role))));
CREATE POLICY "Users can view occupancies in own tenant" ON public.unit_occupancies AS PERMISSIVE FOR SELECT TO public
  USING ((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))));
CREATE POLICY "Admins and Mitarbeiter can manage ownerships" ON public.unit_ownerships AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))) AND (has_role(( SELECT auth.uid() AS uid), tenant_id, 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), tenant_id, 'mitarbeiter'::app_role))));
CREATE POLICY "Users can view ownerships in own tenant" ON public.unit_ownerships AS PERMISSIVE FOR SELECT TO public
  USING ((tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))));
CREATE POLICY "Admins and Mitarbeiter can manage units" ON public.units AS PERMISSIVE FOR ALL TO public
  USING ((object_id IN ( SELECT objects.id
   FROM objects
  WHERE ((objects.tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))) AND (has_role(( SELECT auth.uid() AS uid), objects.tenant_id, 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), objects.tenant_id, 'mitarbeiter'::app_role))))));
CREATE POLICY "Users can view units in own tenant" ON public.units AS PERMISSIVE FOR SELECT TO public
  USING ((object_id IN ( SELECT objects.id
   FROM objects
  WHERE (objects.tenant_id = get_user_tenant_id(( SELECT auth.uid() AS uid))))));
CREATE POLICY "Admins can manage permissions in their tenant" ON public.user_permissions AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.tenant_id = user_permissions.tenant_id) AND (ur.role = 'admin'::app_role)))));
CREATE POLICY "Users can view their own permissions" ON public.user_permissions AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));

-- 9. Konfiguration: Modulkatalog (ohne Preise und Beschreibungen)
INSERT INTO public.saas_modules (id, key, name, category, is_core, is_active, is_beta, sort_order, parent_module_id) VALUES ('0eed0ab7-c317-4ba8-8747-f984fae0b4f0', 'verwaltung', 'Verwaltung', 'business', 'f', 't', 'f', '20', NULL);
INSERT INTO public.saas_modules (id, key, name, category, is_core, is_active, is_beta, sort_order, parent_module_id) VALUES ('222e800e-b54c-4848-acae-ff3ab5739c70', 'aufmass', 'Aufmaß', 'business', 'f', 't', 'f', '14', NULL);
INSERT INTO public.saas_modules (id, key, name, category, is_core, is_active, is_beta, sort_order, parent_module_id) VALUES ('3291217f-5f30-4546-adea-7bff7ab1ff87', 'facility', 'Facility', 'business', 'f', 'f', 'f', '0', NULL);
INSERT INTO public.saas_modules (id, key, name, category, is_core, is_active, is_beta, sort_order, parent_module_id) VALUES ('3ae86eea-172a-44ca-b0ae-cfa6de9ac10e', 'accounting', 'Buchhaltung', 'business', 'f', 'f', 'f', '0', NULL);
INSERT INTO public.saas_modules (id, key, name, category, is_core, is_active, is_beta, sort_order, parent_module_id) VALUES ('55d33a76-7a53-46f1-972b-7cd246bcbf90', 'insurance', 'Versicherung', 'business', 'f', 'f', 'f', '0', NULL);
INSERT INTO public.saas_modules (id, key, name, category, is_core, is_active, is_beta, sort_order, parent_module_id) VALUES ('5c499691-4924-454a-a77e-08513ec324ef', 'orders_bonus', 'Bonus-System', 'addon', 'f', 'f', 'f', '100', NULL);
INSERT INTO public.saas_modules (id, key, name, category, is_core, is_active, is_beta, sort_order, parent_module_id) VALUES ('79b882da-ba4a-47af-94e8-fcc00bef585f', 'billing', 'Fakturierung', 'business', 'f', 'f', 'f', '0', NULL);
INSERT INTO public.saas_modules (id, key, name, category, is_core, is_active, is_beta, sort_order, parent_module_id) VALUES ('7c00db3b-d02e-42af-8a9c-fd6bceb60841', 'jobs', 'Jobs', 'core', 't', 't', 'f', '4', NULL);
INSERT INTO public.saas_modules (id, key, name, category, is_core, is_active, is_beta, sort_order, parent_module_id) VALUES ('af11d1eb-78c9-4ac1-8a3f-65240899be13', 'rental', 'Vermietung', 'business', 'f', 'f', 'f', '0', NULL);
INSERT INTO public.saas_modules (id, key, name, category, is_core, is_active, is_beta, sort_order, parent_module_id) VALUES ('b8d7b3a7-6c1b-43d7-90a4-0447756526a9', 'units', 'Einheiten', 'core', 't', 't', 'f', '2', NULL);
INSERT INTO public.saas_modules (id, key, name, category, is_core, is_active, is_beta, sort_order, parent_module_id) VALUES ('bdebac08-597d-457a-8dbd-50d9cac530b9', 'objects', 'Objekte', 'core', 't', 't', 'f', '1', NULL);
INSERT INTO public.saas_modules (id, key, name, category, is_core, is_active, is_beta, sort_order, parent_module_id) VALUES ('c6eda2d1-293a-45f2-82ce-b060953a9259', 'makler', 'Makler', 'business', 'f', 't', 'f', '10', NULL);
INSERT INTO public.saas_modules (id, key, name, category, is_core, is_active, is_beta, sort_order, parent_module_id) VALUES ('c935360b-3cc7-4aaa-9d36-0c4facfedb7d', 'allocation_keys', 'Umlageschlüssel', 'core', 't', 't', 'f', '6', NULL);
INSERT INTO public.saas_modules (id, key, name, category, is_core, is_active, is_beta, sort_order, parent_module_id) VALUES ('de61ffaf-6a16-4515-9c4b-7436bc95eb24', 'documents', 'Dokumente', 'core', 't', 't', 'f', '5', NULL);
INSERT INTO public.saas_modules (id, key, name, category, is_core, is_active, is_beta, sort_order, parent_module_id) VALUES ('de8ac1b7-5b45-4406-9b26-f5a0a3a1f4a2', 'persons', 'Kontakte', 'core', 't', 't', 'f', '3', NULL);
INSERT INTO public.saas_modules (id, key, name, category, is_core, is_active, is_beta, sort_order, parent_module_id) VALUES ('ee1983e5-1589-42ce-b264-6ed7fb44c649', 'emma', 'Eigentümerversammlung', 'business', 'f', 'f', 'f', '0', NULL);
INSERT INTO public.saas_modules (id, key, name, category, is_core, is_active, is_beta, sort_order, parent_module_id) VALUES ('0e58e72d-5818-47b5-8a92-f3b63c9642f5', 'interessenten', 'Interessenten', 'business', 'f', 't', 'f', '12', 'c6eda2d1-293a-45f2-82ce-b060953a9259');
INSERT INTO public.saas_modules (id, key, name, category, is_core, is_active, is_beta, sort_order, parent_module_id) VALUES ('549c9338-f479-4422-ae43-204d8c29fcd8', 'handover', 'Übergabeprotokoll', 'business', 'f', 't', 'f', '11', 'c6eda2d1-293a-45f2-82ce-b060953a9259');
INSERT INTO public.saas_modules (id, key, name, category, is_core, is_active, is_beta, sort_order, parent_module_id) VALUES ('c317bd07-60d5-420f-a540-fd4c00451156', 'mietvertrag', 'Mietvertrag', 'business', 'f', 't', 'f', '13', 'c6eda2d1-293a-45f2-82ce-b060953a9259');
INSERT INTO public.saas_modules (id, key, name, category, is_core, is_active, is_beta, sort_order, parent_module_id) VALUES ('fc32f8e3-8e1a-4c71-8416-f58a22b2ba6f', 'orders', 'Auftraege', 'business', 'f', 'f', 'f', '50', '3291217f-5f30-4546-adea-7bff7ab1ff87');
-- Platzhalter für das DMS (Werte final erst nach Entscheidung E-1; lokal frei anpassbar):
INSERT INTO public.saas_modules (key, name, category, is_core, is_active, sort_order)
VALUES ('dms', 'DMS (Arbeitstitel)', 'business', false, true, 30);

-- 10. Konfiguration: Rechte je Rolle
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'APPROVE_BONUS');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'APPROVE_PRIMANOTES');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'CREATE_CONTRACTS');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'CREATE_INVOICES');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'CREATE_ORDERS');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'CREATE_TASKS');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'CREATE_TICKETS');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'DATA_IMPORT');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'EDIT_TASKS');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'IMPORT_SERVICES');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'MANAGE_ACCOUNTING');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'MANAGE_BILLING');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'MANAGE_BONUS');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'MANAGE_INSURANCE');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'MANAGE_ORDERS');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'VIEW_ACCOUNTING');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'VIEW_BILLING');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'VIEW_BONUS');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'VIEW_CONTRACTS');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'VIEW_INSURANCE');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'VIEW_ORDERS');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'VIEW_TASKS');
INSERT INTO public.role_permissions (role, permission) VALUES ('admin', 'VIEW_TICKETS');
INSERT INTO public.role_permissions (role, permission) VALUES ('mitarbeiter', 'CREATE_ORDERS');
INSERT INTO public.role_permissions (role, permission) VALUES ('mitarbeiter', 'CREATE_TASKS');
INSERT INTO public.role_permissions (role, permission) VALUES ('mitarbeiter', 'CREATE_TICKETS');
INSERT INTO public.role_permissions (role, permission) VALUES ('mitarbeiter', 'EDIT_TASKS');
INSERT INTO public.role_permissions (role, permission) VALUES ('mitarbeiter', 'VIEW_ORDERS');
INSERT INTO public.role_permissions (role, permission) VALUES ('mitarbeiter', 'VIEW_TASKS');
INSERT INTO public.role_permissions (role, permission) VALUES ('mitarbeiter', 'VIEW_TICKETS');

-- 11. Testzugang anlegen (Vorlage) — nach der Registrierung eines lokalen Nutzers
--     über Supabase Auth die UUID aus auth.users einsetzen. Für RLS-Tests einen
--     zweiten Mandanten mit eigenem Nutzer anlegen.
-- INSERT INTO public.tenants (id, name) VALUES ('00000000-0000-0000-0000-00000000000a', 'Testmandant A');
-- INSERT INTO public.profiles (id, tenant_id, name, email)
--   VALUES ('<auth.users.id>', '00000000-0000-0000-0000-00000000000a', 'Test A', 'a@example.test');
-- INSERT INTO public.user_roles (user_id, tenant_id, role)
--   VALUES ('<auth.users.id>', '00000000-0000-0000-0000-00000000000a', 'admin');
