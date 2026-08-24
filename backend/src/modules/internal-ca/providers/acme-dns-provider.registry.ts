/**
 * lego 原生 DNS Provider 目录。该文件由 lego 的 dnshelp 输出生成。
 * 凭据模板只包含 lego 的 Credentials 段，不包含 Certbot 或 Python 元数据。
 */
export interface AcmeDnsProviderDefinition {
  readonly id: string;
  readonly name: string;
  readonly credentialKeys: readonly string[];
  readonly credentialTemplate: string;
}

interface LegoProviderSeed {
  readonly id: string;
  readonly name: string;
  readonly credentialKeys: readonly string[];
}

const legoProviderSeeds: readonly LegoProviderSeed[] = [
  {
    "id": "abion",
    "credentialKeys": [
      "ABION_API_KEY",
      "ABION_HTTP_TIMEOUT",
      "ABION_POLLING_INTERVAL"
    ],
    "name": "Abion"
  },
  {
    "id": "acmedns",
    "credentialKeys": [
      "ACME_DNS_STORAGE_BASE_URL",
      "ACME_DNS_STORAGE_PATH"
    ],
    "name": "Acmedns"
  },
  {
    "id": "active24",
    "credentialKeys": [
      "ACTIVE24_SECRET"
    ],
    "name": "Active 24"
  },
  {
    "id": "alidns",
    "credentialKeys": [
      "ALICLOUD_ACCESS_KEY",
      "ALICLOUD_RAM_ROLE",
      "ALICLOUD_SECRET_KEY",
      "ALICLOUD_SECURITY_TOKEN"
    ],
    "name": "阿里云 DNS"
  },
  {
    "id": "aliesa",
    "credentialKeys": [
      "ALIESA_RAM_ROLE",
      "ALIESA_SECRET_KEY",
      "ALIESA_SECURITY_TOKEN"
    ],
    "name": "Aliesa"
  },
  {
    "id": "allinkl",
    "credentialKeys": [
      "ALL_INKL_PASSWORD"
    ],
    "name": "Allinkl"
  },
  {
    "id": "alwaysdata",
    "credentialKeys": [
      "ALWAYSDATA_API_KEY",
      "ALWAYSDATA_ACCOUNT",
      "ALWAYSDATA_HTTP_TIMEOUT"
    ],
    "name": "Alwaysdata"
  },
  {
    "id": "anexia",
    "credentialKeys": [
      "ANEXIA_TOKEN",
      "ANEXIA_API_URL",
      "ANEXIA_HTTP_TIMEOUT"
    ],
    "name": "Anexia"
  },
  {
    "id": "artfiles",
    "credentialKeys": [
      "ARTFILES_USERNAME"
    ],
    "name": "Artfiles"
  },
  {
    "id": "arvancloud",
    "credentialKeys": [
      "ARVANCLOUD_API_KEY",
      "ARVANCLOUD_HTTP_TIMEOUT",
      "ARVANCLOUD_POLLING_INTERVAL"
    ],
    "name": "Arvancloud"
  },
  {
    "id": "auroradns",
    "credentialKeys": [
      "AURORA_SECRET"
    ],
    "name": "Auroradns"
  },
  {
    "id": "autodns",
    "credentialKeys": [
      "AUTODNS_API_USER"
    ],
    "name": "Autodns"
  },
  {
    "id": "axelname",
    "credentialKeys": [
      "AXELNAME_TOKEN"
    ],
    "name": "Axelname"
  },
  {
    "id": "azion",
    "credentialKeys": [
      "AZION_PERSONAL_TOKEN",
      "AZION_HTTP_TIMEOUT",
      "AZION_PAGE_SIZE"
    ],
    "name": "Azion"
  },
  {
    "id": "azuredns",
    "credentialKeys": [
      "AZURE_CLIENT_ID",
      "AZURE_CLIENT_SECRET",
      "AZURE_TENANT_ID"
    ],
    "name": "Azuredns"
  },
  {
    "id": "baiducloud",
    "credentialKeys": [
      "BAIDUCLOUD_SECRET_ACCESS_KEY"
    ],
    "name": "百度智能云"
  },
  {
    "id": "beget",
    "credentialKeys": [
      "BEGET_USERNAME"
    ],
    "name": "Beget"
  },
  {
    "id": "binarylane",
    "credentialKeys": [
      "BINARYLANE_API_TOKEN",
      "BINARYLANE_HTTP_TIMEOUT",
      "BINARYLANE_POLLING_INTERVAL"
    ],
    "name": "Binarylane"
  },
  {
    "id": "bindman",
    "credentialKeys": [
      "BINDMAN_MANAGER_ADDRESS",
      "BINDMAN_HTTP_TIMEOUT",
      "BINDMAN_POLLING_INTERVAL"
    ],
    "name": "Bindman"
  },
  {
    "id": "bluecat",
    "credentialKeys": [
      "BLUECAT_DNS_VIEW",
      "BLUECAT_PASSWORD",
      "BLUECAT_SERVER_URL",
      "BLUECAT_USER_NAME"
    ],
    "name": "Bluecat"
  },
  {
    "id": "bluecatv2",
    "credentialKeys": [
      "BLUECATV2_PASSWORD",
      "BLUECATV2_SERVER_URL",
      "BLUECATV2_USERNAME",
      "BLUECATV2_VIEW_NAME"
    ],
    "name": "Bluecatv 2"
  },
  {
    "id": "bookmyname",
    "credentialKeys": [
      "BOOKMYNAME_USERNAME"
    ],
    "name": "Bookmyname"
  },
  {
    "id": "bunny",
    "credentialKeys": [
      "BUNNY_API_KEY",
      "BUNNY_HTTP_TIMEOUT",
      "BUNNY_POLLING_INTERVAL"
    ],
    "name": "Bunny"
  },
  {
    "id": "checkdomain",
    "credentialKeys": [
      "CHECKDOMAIN_TOKEN",
      "CHECKDOMAIN_ENDPOINT",
      "CHECKDOMAIN_HTTP_TIMEOUT"
    ],
    "name": "Checkdomain"
  },
  {
    "id": "civo",
    "credentialKeys": [
      "CIVO_TOKEN",
      "CIVO_HTTP_TIMEOUT",
      "CIVO_POLLING_INTERVAL"
    ],
    "name": "Civo"
  },
  {
    "id": "clouddns",
    "credentialKeys": [
      "CLOUDDNS_EMAIL",
      "CLOUDDNS_PASSWORD"
    ],
    "name": "Clouddns"
  },
  {
    "id": "cloudflare",
    "credentialKeys": [
      "CF_API_KEY",
      "CF_DNS_API_TOKEN",
      "CF_ZONE_API_TOKEN",
      "CLOUDFLARE_API_KEY",
      "CLOUDFLARE_DNS_API_TOKEN",
      "CLOUDFLARE_EMAIL",
      "CLOUDFLARE_ZONE_API_TOKEN"
    ],
    "name": "Cloudflare"
  },
  {
    "id": "cloudns",
    "credentialKeys": [
      "CLOUDNS_AUTH_PASSWORD"
    ],
    "name": "Cloudns"
  },
  {
    "id": "cloudru",
    "credentialKeys": [
      "CLOUDRU_SECRET",
      "CLOUDRU_SERVICE_INSTANCE_ID"
    ],
    "name": "Cloudru"
  },
  {
    "id": "com35",
    "credentialKeys": [
      "COM35_USERNAME"
    ],
    "name": "Com 35"
  },
  {
    "id": "connbyte",
    "credentialKeys": [
      "CONNBYTE_TOKEN",
      "CONNBYTE_HTTP_TIMEOUT",
      "CONNBYTE_POLLING_INTERVAL"
    ],
    "name": "Connbyte"
  },
  {
    "id": "conoha",
    "credentialKeys": [
      "CONOHA_API_USERNAME",
      "CONOHA_TENANT_ID"
    ],
    "name": "Conoha"
  },
  {
    "id": "conohav3",
    "credentialKeys": [
      "CONOHAV3_API_USER_ID",
      "CONOHAV3_TENANT_ID"
    ],
    "name": "Conohav 3"
  },
  {
    "id": "constellix",
    "credentialKeys": [
      "CONSTELLIX_SECRET_KEY"
    ],
    "name": "Constellix"
  },
  {
    "id": "corenetworks",
    "credentialKeys": [
      "CORENETWORKS_PASSWORD"
    ],
    "name": "Corenetworks"
  },
  {
    "id": "cpanel",
    "credentialKeys": [
      "CPANEL_TOKEN",
      "CPANEL_USERNAME"
    ],
    "name": "Cpanel"
  },
  {
    "id": "curanet",
    "credentialKeys": [
      "CURANET_API_KEY",
      "CURANET_HTTP_TIMEOUT",
      "CURANET_POLLING_INTERVAL"
    ],
    "name": "Curanet"
  },
  {
    "id": "czechia",
    "credentialKeys": [
      "CZECHIA_TOKEN",
      "CZECHIA_HTTP_TIMEOUT",
      "CZECHIA_POLLING_INTERVAL"
    ],
    "name": "Czechia"
  },
  {
    "id": "dandomain",
    "credentialKeys": [
      "DANDOMAIN_API_KEY",
      "DANDOMAIN_HTTP_TIMEOUT",
      "DANDOMAIN_POLLING_INTERVAL"
    ],
    "name": "Dandomain"
  },
  {
    "id": "ddnss",
    "credentialKeys": [
      "DDNSS_KEY",
      "DDNSS_HTTP_TIMEOUT",
      "DDNSS_POLLING_INTERVAL"
    ],
    "name": "Ddnss"
  },
  {
    "id": "derak",
    "credentialKeys": [
      "DERAK_API_KEY",
      "DERAK_HTTP_TIMEOUT",
      "DERAK_POLLING_INTERVAL"
    ],
    "name": "Derak"
  },
  {
    "id": "desec",
    "credentialKeys": [
      "DESEC_TOKEN",
      "DESEC_HTTP_TIMEOUT",
      "DESEC_POLLING_INTERVAL"
    ],
    "name": "Desec"
  },
  {
    "id": "designate",
    "credentialKeys": [
      "OS_APPLICATION_CREDENTIAL_NAME",
      "OS_APPLICATION_CREDENTIAL_SECRET",
      "OS_AUTH_URL",
      "OS_PASSWORD",
      "OS_PROJECT_NAME",
      "OS_REGION_NAME",
      "OS_USERNAME",
      "OS_USER_ID"
    ],
    "name": "Designate"
  },
  {
    "id": "digitalocean",
    "credentialKeys": [
      "DO_AUTH_TOKEN",
      "DO_API_URL",
      "DO_HTTP_TIMEOUT"
    ],
    "name": "Digitalocean"
  },
  {
    "id": "dinahosting",
    "credentialKeys": [
      "DINAHOSTING_USERNAME"
    ],
    "name": "Dinahosting"
  },
  {
    "id": "directadmin",
    "credentialKeys": [
      "DIRECTADMIN_PASSWORD",
      "DIRECTADMIN_USERNAME"
    ],
    "name": "Directadmin"
  },
  {
    "id": "dns51",
    "credentialKeys": [
      "DNS51_API_SECRET"
    ],
    "name": "Dns 51"
  },
  {
    "id": "dnscale",
    "credentialKeys": [
      "DNSCALE_API_TOKEN",
      "DNSCALE_HTTP_TIMEOUT",
      "DNSCALE_POLLING_INTERVAL"
    ],
    "name": "Dnscale"
  },
  {
    "id": "dnsexit",
    "credentialKeys": [
      "DNSEXIT_API_KEY",
      "DNSEXIT_HTTP_TIMEOUT",
      "DNSEXIT_POLLING_INTERVAL"
    ],
    "name": "Dnsexit"
  },
  {
    "id": "dnshomede",
    "credentialKeys": [
      "DNSHOMEDE_CREDENTIALS",
      "DNSHOMEDE_HTTP_TIMEOUT",
      "DNSHOMEDE_POLLING_INTERVAL"
    ],
    "name": "Dnshomede"
  },
  {
    "id": "dnsimple",
    "credentialKeys": [
      "DNSIMPLE_OAUTH_TOKEN",
      "DNSIMPLE_BASE_URL",
      "DNSIMPLE_POLLING_INTERVAL"
    ],
    "name": "Dnsimple"
  },
  {
    "id": "dnsla",
    "credentialKeys": [
      "DNSLA_API_SECRET"
    ],
    "name": "Dnsla"
  },
  {
    "id": "dnsmadeeasy",
    "credentialKeys": [
      "DNSMADEEASY_API_SECRET"
    ],
    "name": "Dnsmadeeasy"
  },
  {
    "id": "dnsservices",
    "credentialKeys": [
      "DNSSERVICES_USERNAME"
    ],
    "name": "Dnsservices"
  },
  {
    "id": "dnsupdate",
    "credentialKeys": [
      "DNSUPDATE_NAMESERVER",
      "DNSUPDATE_DNS_TIMEOUT",
      "DNSUPDATE_POLLING_INTERVAL"
    ],
    "name": "Dnsupdate"
  },
  {
    "id": "dode",
    "credentialKeys": [
      "DODE_TOKEN",
      "DODE_HTTP_TIMEOUT",
      "DODE_POLLING_INTERVAL"
    ],
    "name": "Dode"
  },
  {
    "id": "domeneshop",
    "credentialKeys": [
      "DOMENESHOP_API_TOKEN"
    ],
    "name": "Domeneshop"
  },
  {
    "id": "dreamhost",
    "credentialKeys": [
      "DREAMHOST_API_KEY",
      "DREAMHOST_HTTP_TIMEOUT",
      "DREAMHOST_POLLING_INTERVAL"
    ],
    "name": "Dreamhost"
  },
  {
    "id": "duckdns",
    "credentialKeys": [
      "DUCKDNS_TOKEN",
      "DUCKDNS_HTTP_TIMEOUT",
      "DUCKDNS_POLLING_INTERVAL"
    ],
    "name": "Duckdns"
  },
  {
    "id": "dyn",
    "credentialKeys": [
      "DYN_PASSWORD",
      "DYN_USER_NAME"
    ],
    "name": "Dyn"
  },
  {
    "id": "dynadot",
    "credentialKeys": [
      "DYNADOT_API_SECRET"
    ],
    "name": "Dynadot"
  },
  {
    "id": "dyndnsfree",
    "credentialKeys": [
      "DYNDNSFREE_USERNAME"
    ],
    "name": "Dyndnsfree"
  },
  {
    "id": "dynu",
    "credentialKeys": [
      "DYNU_API_KEY",
      "DYNU_HTTP_TIMEOUT",
      "DYNU_POLLING_INTERVAL"
    ],
    "name": "Dynu"
  },
  {
    "id": "easydns",
    "credentialKeys": [
      "EASYDNS_TOKEN"
    ],
    "name": "Easydns"
  },
  {
    "id": "edgecenter",
    "credentialKeys": [
      "EDGECENTER_PERMANENT_API_TOKEN",
      "EDGECENTER_HTTP_TIMEOUT",
      "EDGECENTER_POLLING_INTERVAL"
    ],
    "name": "Edgecenter"
  },
  {
    "id": "edgedns",
    "credentialKeys": [
      "AKAMAI_CLIENT_SECRET",
      "AKAMAI_CLIENT_TOKEN",
      "AKAMAI_EDGERC",
      "AKAMAI_EDGERC_SECTION",
      "AKAMAI_HOST"
    ],
    "name": "Edgedns"
  },
  {
    "id": "edgeone",
    "credentialKeys": [
      "EDGEONE_SECRET_KEY"
    ],
    "name": "Edgeone"
  },
  {
    "id": "efficientip",
    "credentialKeys": [
      "EFFICIENTIP_HOSTNAME",
      "EFFICIENTIP_PASSWORD",
      "EFFICIENTIP_USERNAME"
    ],
    "name": "Efficientip"
  },
  {
    "id": "epik",
    "credentialKeys": [
      "EPIK_SIGNATURE",
      "EPIK_HTTP_TIMEOUT",
      "EPIK_POLLING_INTERVAL"
    ],
    "name": "Epik"
  },
  {
    "id": "eurodns",
    "credentialKeys": [
      "EURODNS_APP_ID"
    ],
    "name": "Eurodns"
  },
  {
    "id": "euserv",
    "credentialKeys": [
      "EUSERV_ORDER_ID",
      "EUSERV_PASSWORD"
    ],
    "name": "Euserv"
  },
  {
    "id": "excedo",
    "credentialKeys": [
      "EXCEDO_API_URL"
    ],
    "name": "Excedo"
  },
  {
    "id": "exec",
    "credentialKeys": [],
    "name": "Exec"
  },
  {
    "id": "exoscale",
    "credentialKeys": [
      "EXOSCALE_API_SECRET"
    ],
    "name": "Exoscale"
  },
  {
    "id": "f5xc",
    "credentialKeys": [
      "F5XC_GROUP_NAME",
      "F5XC_TENANT_NAME"
    ],
    "name": "F 5xc"
  },
  {
    "id": "fornex",
    "credentialKeys": [
      "FORNEX_API_KEY",
      "FORNEX_HTTP_TIMEOUT",
      "FORNEX_POLLING_INTERVAL"
    ],
    "name": "Fornex"
  },
  {
    "id": "freemyip",
    "credentialKeys": [
      "FREEMYIP_TOKEN",
      "FREEMYIP_HTTP_TIMEOUT",
      "FREEMYIP_POLLING_INTERVAL"
    ],
    "name": "Freemyip"
  },
  {
    "id": "gandi",
    "credentialKeys": [
      "GANDI_API_KEY",
      "GANDI_HTTP_TIMEOUT",
      "GANDI_POLLING_INTERVAL"
    ],
    "name": "Gandi"
  },
  {
    "id": "gandiv5",
    "credentialKeys": [
      "GANDIV5_PERSONAL_ACCESS_TOKEN"
    ],
    "name": "Gandiv 5"
  },
  {
    "id": "gcloud",
    "credentialKeys": [
      "GCE_PROJECT",
      "GCE_SERVICE_ACCOUNT",
      "GCE_SERVICE_ACCOUNT_FILE"
    ],
    "name": "Gcloud"
  },
  {
    "id": "gcore",
    "credentialKeys": [
      "GCORE_PERMANENT_API_TOKEN",
      "GCORE_HTTP_TIMEOUT",
      "GCORE_POLLING_INTERVAL"
    ],
    "name": "Gcore"
  },
  {
    "id": "gehirn",
    "credentialKeys": [
      "GEHIRN_TOKEN_SECRET"
    ],
    "name": "Gehirn"
  },
  {
    "id": "gigahostno",
    "credentialKeys": [
      "GIGAHOSTNO_PASSWORD",
      "GIGAHOSTNO_USERNAME"
    ],
    "name": "Gigahostno"
  },
  {
    "id": "glesys",
    "credentialKeys": [
      "GLESYS_API_USER"
    ],
    "name": "Glesys"
  },
  {
    "id": "gname",
    "credentialKeys": [
      "GNAME_APP_KEY"
    ],
    "name": "Gname"
  },
  {
    "id": "godaddy",
    "credentialKeys": [
      "GODADDY_API_SECRET"
    ],
    "name": "Godaddy"
  },
  {
    "id": "gravity",
    "credentialKeys": [
      "GRAVITY_SERVER_URL",
      "GRAVITY_USERNAME"
    ],
    "name": "Gravity"
  },
  {
    "id": "hetzner",
    "credentialKeys": [
      "HETZNER_API_TOKEN",
      "HETZNER_HTTP_TIMEOUT",
      "HETZNER_POLLING_INTERVAL"
    ],
    "name": "Hetzner"
  },
  {
    "id": "hostingde",
    "credentialKeys": [
      "HOSTINGDE_API_KEY",
      "HOSTINGDE_HTTP_TIMEOUT",
      "HOSTINGDE_POLLING_INTERVAL"
    ],
    "name": "Hostingde"
  },
  {
    "id": "hostinger",
    "credentialKeys": [
      "HOSTINGER_API_TOKEN",
      "HOSTINGER_HTTP_TIMEOUT",
      "HOSTINGER_POLLING_INTERVAL"
    ],
    "name": "Hostinger"
  },
  {
    "id": "hostingnl",
    "credentialKeys": [
      "HOSTINGNL_API_KEY",
      "HOSTINGNL_HTTP_TIMEOUT",
      "HOSTINGNL_POLLING_INTERVAL"
    ],
    "name": "Hostingnl"
  },
  {
    "id": "hosttech",
    "credentialKeys": [
      "HOSTTECH_PASSWORD"
    ],
    "name": "Hosttech"
  },
  {
    "id": "hostup",
    "credentialKeys": [
      "HOSTUP_API_KEY",
      "HOSTUP_HTTP_TIMEOUT",
      "HOSTUP_POLLING_INTERVAL"
    ],
    "name": "Hostup"
  },
  {
    "id": "httpnet",
    "credentialKeys": [
      "HTTPNET_API_KEY",
      "HTTPNET_HTTP_TIMEOUT",
      "HTTPNET_POLLING_INTERVAL"
    ],
    "name": "Httpnet"
  },
  {
    "id": "httpreq",
    "credentialKeys": [
      "HTTPREQ_MODE"
    ],
    "name": "Httpreq"
  },
  {
    "id": "huaweicloud",
    "credentialKeys": [
      "HUAWEICLOUD_REGION",
      "HUAWEICLOUD_SECRET_ACCESS_KEY"
    ],
    "name": "Huaweicloud"
  },
  {
    "id": "hurricane",
    "credentialKeys": [
      "HURRICANE_TOKENS",
      "HURRICANE_HTTP_TIMEOUT",
      "HURRICANE_POLLING_INTERVAL"
    ],
    "name": "Hurricane"
  },
  {
    "id": "hyperone",
    "credentialKeys": [
      "HYPERONE_API_URL",
      "HYPERONE_HTTP_TIMEOUT",
      "HYPERONE_LOCATION_ID"
    ],
    "name": "Hyperone"
  },
  {
    "id": "ibmcloud",
    "credentialKeys": [
      "SOFTLAYER_USERNAME"
    ],
    "name": "Ibmcloud"
  },
  {
    "id": "iijdpf",
    "credentialKeys": [
      "IIJ_DPF_DPM_SERVICE_CODE"
    ],
    "name": "Iijdpf"
  },
  {
    "id": "infoblox",
    "credentialKeys": [
      "INFOBLOX_PASSWORD",
      "INFOBLOX_USERNAME"
    ],
    "name": "Infoblox"
  },
  {
    "id": "infomaniak",
    "credentialKeys": [
      "INFOMANIAK_ACCESS_TOKEN",
      "INFOMANIAK_ENDPOINT",
      "INFOMANIAK_HTTP_TIMEOUT"
    ],
    "name": "Infomaniak"
  },
  {
    "id": "internetbs",
    "credentialKeys": [
      "INTERNET_BS_PASSWORD"
    ],
    "name": "Internetbs"
  },
  {
    "id": "inwx",
    "credentialKeys": [
      "INWX_USERNAME"
    ],
    "name": "Inwx"
  },
  {
    "id": "ionos",
    "credentialKeys": [
      "IONOS_API_KEY",
      "IONOS_HTTP_TIMEOUT",
      "IONOS_POLLING_INTERVAL"
    ],
    "name": "Ionos"
  },
  {
    "id": "ionoscloud",
    "credentialKeys": [
      "IONOSCLOUD_API_TOKEN",
      "IONOSCLOUD_HTTP_TIMEOUT",
      "IONOSCLOUD_POLLING_INTERVAL"
    ],
    "name": "Ionoscloud"
  },
  {
    "id": "ipv64",
    "credentialKeys": [
      "IPV64_API_KEY",
      "IPV64_HTTP_TIMEOUT",
      "IPV64_POLLING_INTERVAL"
    ],
    "name": "Ipv 64"
  },
  {
    "id": "ispconfig",
    "credentialKeys": [
      "ISPCONFIG_SERVER_URL",
      "ISPCONFIG_USERNAME"
    ],
    "name": "Ispconfig"
  },
  {
    "id": "ispconfigddns",
    "credentialKeys": [
      "ISPCONFIG_DDNS_TOKEN"
    ],
    "name": "Ispconfigddns"
  },
  {
    "id": "jdcloud",
    "credentialKeys": [
      "JDCLOUD_ACCESS_KEY_SECRET"
    ],
    "name": "Jdcloud"
  },
  {
    "id": "joker",
    "credentialKeys": [
      "JOKER_API_MODE",
      "JOKER_PASSWORD",
      "JOKER_USERNAME"
    ],
    "name": "Joker"
  },
  {
    "id": "katapult",
    "credentialKeys": [
      "KATAPULT_API_KEY",
      "KATAPULT_HTTP_TIMEOUT",
      "KATAPULT_POLLING_INTERVAL"
    ],
    "name": "Katapult"
  },
  {
    "id": "keyhelp",
    "credentialKeys": [
      "KEYHELP_BASE_URL"
    ],
    "name": "Keyhelp"
  },
  {
    "id": "leaseweb",
    "credentialKeys": [
      "LEASEWEB_API_KEY",
      "LEASEWEB_HTTP_TIMEOUT",
      "LEASEWEB_POLLING_INTERVAL"
    ],
    "name": "Leaseweb"
  },
  {
    "id": "liara",
    "credentialKeys": [
      "LIARA_API_KEY",
      "LIARA_HTTP_TIMEOUT",
      "LIARA_POLLING_INTERVAL"
    ],
    "name": "Liara"
  },
  {
    "id": "lightsail",
    "credentialKeys": [
      "AWS_SECRET_ACCESS_KEY",
      "DNS_ZONE"
    ],
    "name": "Lightsail"
  },
  {
    "id": "limacity",
    "credentialKeys": [
      "LIMACITY_API_KEY",
      "LIMACITY_HTTP_TIMEOUT",
      "LIMACITY_POLLING_INTERVAL"
    ],
    "name": "Limacity"
  },
  {
    "id": "linode",
    "credentialKeys": [
      "LINODE_TOKEN",
      "LINODE_HTTP_TIMEOUT",
      "LINODE_POLLING_INTERVAL"
    ],
    "name": "Linode"
  },
  {
    "id": "liquidweb",
    "credentialKeys": [
      "LWAPI_USERNAME"
    ],
    "name": "Liquidweb"
  },
  {
    "id": "loopia",
    "credentialKeys": [
      "LOOPIA_API_USER"
    ],
    "name": "Loopia"
  },
  {
    "id": "luadns",
    "credentialKeys": [
      "LUADNS_API_USERNAME"
    ],
    "name": "Luadns"
  },
  {
    "id": "mailinabox",
    "credentialKeys": [
      "MAILINABOX_EMAIL",
      "MAILINABOX_PASSWORD"
    ],
    "name": "Mailinabox"
  },
  {
    "id": "manageengine",
    "credentialKeys": [
      "MANAGEENGINE_CLIENT_SECRET"
    ],
    "name": "Manageengine"
  },
  {
    "id": "manual",
    "credentialKeys": [
      "MANUAL_POLLING_INTERVAL",
      "MANUAL_PROPAGATION_TIMEOUT"
    ],
    "name": "Manual"
  },
  {
    "id": "metaname",
    "credentialKeys": [
      "METANAME_API_KEY"
    ],
    "name": "Metaname"
  },
  {
    "id": "metaregistrar",
    "credentialKeys": [
      "METAREGISTRAR_API_TOKEN",
      "METAREGISTRAR_HTTP_TIMEOUT",
      "METAREGISTRAR_POLLING_INTERVAL"
    ],
    "name": "Metaregistrar"
  },
  {
    "id": "mijnhost",
    "credentialKeys": [
      "MIJNHOST_API_KEY",
      "MIJNHOST_HTTP_TIMEOUT",
      "MIJNHOST_POLLING_INTERVAL"
    ],
    "name": "Mijnhost"
  },
  {
    "id": "mittwald",
    "credentialKeys": [
      "MITTWALD_TOKEN",
      "MITTWALD_HTTP_TIMEOUT",
      "MITTWALD_POLLING_INTERVAL"
    ],
    "name": "Mittwald"
  },
  {
    "id": "myaddr",
    "credentialKeys": [
      "MYADDR_PRIVATE_KEYS_MAPPING",
      "MYADDR_HTTP_TIMEOUT",
      "MYADDR_POLLING_INTERVAL"
    ],
    "name": "Myaddr"
  },
  {
    "id": "mydnsjp",
    "credentialKeys": [
      "MYDNSJP_PASSWORD"
    ],
    "name": "Mydnsjp"
  },
  {
    "id": "mythicbeasts",
    "credentialKeys": [
      "MYTHICBEASTS_USERNAME"
    ],
    "name": "Mythicbeasts"
  },
  {
    "id": "namecheap",
    "credentialKeys": [
      "NAMECHEAP_API_USER"
    ],
    "name": "Namecheap"
  },
  {
    "id": "namedotcom",
    "credentialKeys": [
      "NAMECOM_USERNAME"
    ],
    "name": "Name.com"
  },
  {
    "id": "namesilo",
    "credentialKeys": [
      "NAMESILO_API_KEY",
      "NAMESILO_POLLING_INTERVAL",
      "NAMESILO_PROPAGATION_TIMEOUT"
    ],
    "name": "Namesilo"
  },
  {
    "id": "namesurfer",
    "credentialKeys": [
      "NAMESURFER_API_SECRET",
      "NAMESURFER_BASE_URL"
    ],
    "name": "Namesurfer"
  },
  {
    "id": "nearlyfreespeech",
    "credentialKeys": [
      "NEARLYFREESPEECH_LOGIN"
    ],
    "name": "Nearlyfreespeech"
  },
  {
    "id": "nederhost",
    "credentialKeys": [
      "NEDERHOST_API_KEY",
      "NEDERHOST_HTTP_TIMEOUT",
      "NEDERHOST_POLLING_INTERVAL"
    ],
    "name": "Nederhost"
  },
  {
    "id": "neodigit",
    "credentialKeys": [
      "NEODIGIT_TOKEN",
      "NEODIGIT_HTTP_TIMEOUT",
      "NEODIGIT_POLLING_INTERVAL"
    ],
    "name": "Neodigit"
  },
  {
    "id": "netcup",
    "credentialKeys": [
      "NETCUP_API_PASSWORD",
      "NETCUP_CUSTOMER_NUMBER"
    ],
    "name": "Netcup"
  },
  {
    "id": "netlify",
    "credentialKeys": [
      "NETLIFY_TOKEN",
      "NETLIFY_HTTP_TIMEOUT",
      "NETLIFY_POLLING_INTERVAL"
    ],
    "name": "Netlify"
  },
  {
    "id": "netnod",
    "credentialKeys": [
      "NETNOD_TOKEN",
      "NETNOD_HTTP_TIMEOUT",
      "NETNOD_POLLING_INTERVAL"
    ],
    "name": "Netnod"
  },
  {
    "id": "nexdns",
    "credentialKeys": [
      "NEXDNS_API_TOKEN",
      "NEXDNS_HTTP_TIMEOUT",
      "NEXDNS_POLLING_INTERVAL"
    ],
    "name": "Nexdns"
  },
  {
    "id": "ngenix",
    "credentialKeys": [
      "NGENIX_TOKEN",
      "NGENIX_USERNAME"
    ],
    "name": "Ngenix"
  },
  {
    "id": "nicmanager",
    "credentialKeys": [
      "NICMANAGER_API_LOGIN",
      "NICMANAGER_API_PASSWORD",
      "NICMANAGER_API_USERNAME"
    ],
    "name": "Nicmanager"
  },
  {
    "id": "nicru",
    "credentialKeys": [
      "NICRU_SECRET",
      "NICRU_SERVICE_ID",
      "NICRU_USER"
    ],
    "name": "Nicru"
  },
  {
    "id": "nifcloud",
    "credentialKeys": [
      "NIFCLOUD_SECRET_ACCESS_KEY"
    ],
    "name": "Nifcloud"
  },
  {
    "id": "njalla",
    "credentialKeys": [
      "NJALLA_TOKEN",
      "NJALLA_HTTP_TIMEOUT",
      "NJALLA_POLLING_INTERVAL"
    ],
    "name": "Njalla"
  },
  {
    "id": "nodion",
    "credentialKeys": [
      "NODION_API_TOKEN",
      "NODION_HTTP_TIMEOUT",
      "NODION_POLLING_INTERVAL"
    ],
    "name": "Nodion"
  },
  {
    "id": "ns1",
    "credentialKeys": [
      "NS1_API_KEY",
      "NS1_HTTP_TIMEOUT",
      "NS1_POLLING_INTERVAL"
    ],
    "name": "NS1"
  },
  {
    "id": "octenium",
    "credentialKeys": [
      "OCTENIUM_API_KEY",
      "OCTENIUM_HTTP_TIMEOUT",
      "OCTENIUM_POLLING_INTERVAL"
    ],
    "name": "Octenium"
  },
  {
    "id": "omglol",
    "credentialKeys": [
      "OMGLOL_API_KEY",
      "OMGLOL_HTTP_TIMEOUT",
      "OMGLOL_POLLING_INTERVAL"
    ],
    "name": "Omglol"
  },
  {
    "id": "onecloudru",
    "credentialKeys": [
      "ONECLOUDRU_TOKEN",
      "ONECLOUDRU_HTTP_TIMEOUT",
      "ONECLOUDRU_POLLING_INTERVAL"
    ],
    "name": "Onecloudru"
  },
  {
    "id": "onlinenet",
    "credentialKeys": [
      "ONLINENET_API_TOKEN",
      "ONLINENET_HTTP_TIMEOUT",
      "ONLINENET_POLLING_INTERVAL"
    ],
    "name": "Onlinenet"
  },
  {
    "id": "openprovider",
    "credentialKeys": [
      "OPENPROVIDER_USERNAME"
    ],
    "name": "Openprovider"
  },
  {
    "id": "opusdns",
    "credentialKeys": [
      "OPUSDNS_API_KEY",
      "OPUSDNS_HTTP_TIMEOUT",
      "OPUSDNS_POLLING_INTERVAL"
    ],
    "name": "Opusdns"
  },
  {
    "id": "oraclecloud",
    "credentialKeys": [
      "OCI_FINGERPRINT",
      "OCI_PRIVATE_KEY_PASSWORD",
      "OCI_PRIVATE_KEY_PATH",
      "OCI_REGION",
      "OCI_TENANCY_OCID",
      "OCI_USER_OCID"
    ],
    "name": "Oracle Cloud Infrastructure DNS"
  },
  {
    "id": "otc",
    "credentialKeys": [
      "OTC_PASSWORD",
      "OTC_PROJECT_NAME",
      "OTC_USER_NAME"
    ],
    "name": "Otc"
  },
  {
    "id": "ovh",
    "credentialKeys": [
      "OVH_APPLICATION_KEY",
      "OVH_APPLICATION_SECRET",
      "OVH_CLIENT_ID",
      "OVH_CLIENT_SECRET",
      "OVH_CONSUMER_KEY",
      "OVH_ENDPOINT"
    ],
    "name": "Ovh"
  },
  {
    "id": "pdns",
    "credentialKeys": [
      "PDNS_API_URL"
    ],
    "name": "PowerDNS"
  },
  {
    "id": "plesk",
    "credentialKeys": [
      "PLESK_SERVER_BASE_URL",
      "PLESK_USERNAME"
    ],
    "name": "Plesk"
  },
  {
    "id": "pointdns",
    "credentialKeys": [
      "POINTDNS_USERNAME"
    ],
    "name": "Pointdns"
  },
  {
    "id": "porkbun",
    "credentialKeys": [
      "PORKBUN_SECRET_API_KEY"
    ],
    "name": "Porkbun"
  },
  {
    "id": "poweradmin",
    "credentialKeys": [
      "POWERADMIN_BASE_URL"
    ],
    "name": "Poweradmin"
  },
  {
    "id": "rackspace",
    "credentialKeys": [
      "RACKSPACE_USER"
    ],
    "name": "Rackspace"
  },
  {
    "id": "rage4",
    "credentialKeys": [
      "RAGE4_USERNAME"
    ],
    "name": "Rage 4"
  },
  {
    "id": "rainyun",
    "credentialKeys": [
      "RAINYUN_API_KEY",
      "RAINYUN_HTTP_TIMEOUT",
      "RAINYUN_POLLING_INTERVAL"
    ],
    "name": "Rainyun"
  },
  {
    "id": "rcodezero",
    "credentialKeys": [
      "RCODEZERO_API_TOKEN",
      "RCODEZERO_HTTP_TIMEOUT",
      "RCODEZERO_POLLING_INTERVAL"
    ],
    "name": "Rcodezero"
  },
  {
    "id": "regfish",
    "credentialKeys": [
      "REGFISH_API_KEY",
      "REGFISH_HTTP_TIMEOUT",
      "REGFISH_POLLING_INTERVAL"
    ],
    "name": "Regfish"
  },
  {
    "id": "regru",
    "credentialKeys": [
      "REGRU_USERNAME"
    ],
    "name": "Regru"
  },
  {
    "id": "rimuhosting",
    "credentialKeys": [
      "RIMUHOSTING_API_KEY",
      "RIMUHOSTING_HTTP_TIMEOUT",
      "RIMUHOSTING_POLLING_INTERVAL"
    ],
    "name": "Rimuhosting"
  },
  {
    "id": "route53",
    "credentialKeys": [
      "AWS_ASSUME_ROLE_ARN",
      "AWS_EXTERNAL_ID",
      "AWS_HOSTED_ZONE_ID",
      "AWS_PROFILE",
      "AWS_REGION",
      "AWS_SDK_LOAD_CONFIG",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_WAIT_FOR_RECORD_SETS_CHANGED"
    ],
    "name": "Route 53 (Amazon)"
  },
  {
    "id": "safedns",
    "credentialKeys": [
      "SAFEDNS_AUTH_TOKEN",
      "SAFEDNS_HTTP_TIMEOUT",
      "SAFEDNS_POLLING_INTERVAL"
    ],
    "name": "Safedns"
  },
  {
    "id": "sakuracloud",
    "credentialKeys": [
      "SAKURACLOUD_ACCESS_TOKEN_SECRET"
    ],
    "name": "Sakuracloud"
  },
  {
    "id": "scaleway",
    "credentialKeys": [
      "SCW_SECRET_KEY"
    ],
    "name": "Scaleway"
  },
  {
    "id": "scannet",
    "credentialKeys": [
      "SCANNET_API_KEY",
      "SCANNET_HTTP_TIMEOUT",
      "SCANNET_POLLING_INTERVAL"
    ],
    "name": "Scannet"
  },
  {
    "id": "selectel",
    "credentialKeys": [
      "SELECTEL_API_TOKEN",
      "SELECTEL_HTTP_TIMEOUT",
      "SELECTEL_POLLING_INTERVAL"
    ],
    "name": "Selectel"
  },
  {
    "id": "selectelv2",
    "credentialKeys": [
      "SELECTELV2_PASSWORD",
      "SELECTELV2_PROJECT_ID",
      "SELECTELV2_USERNAME"
    ],
    "name": "Selectelv 2"
  },
  {
    "id": "selfhostde",
    "credentialKeys": [
      "SELFHOSTDE_RECORDS_MAPPING",
      "SELFHOSTDE_USERNAME"
    ],
    "name": "Selfhostde"
  },
  {
    "id": "servercow",
    "credentialKeys": [
      "SERVERCOW_USERNAME"
    ],
    "name": "Servercow"
  },
  {
    "id": "shellrent",
    "credentialKeys": [
      "SHELLRENT_USERNAME"
    ],
    "name": "Shellrent"
  },
  {
    "id": "simply",
    "credentialKeys": [
      "SIMPLY_API_KEY"
    ],
    "name": "Simply"
  },
  {
    "id": "sonic",
    "credentialKeys": [
      "SONIC_USER_ID"
    ],
    "name": "Sonic"
  },
  {
    "id": "spaceship",
    "credentialKeys": [
      "SPACESHIP_API_SECRET"
    ],
    "name": "Spaceship"
  },
  {
    "id": "stackpath",
    "credentialKeys": [
      "STACKPATH_CLIENT_SECRET",
      "STACKPATH_STACK_ID"
    ],
    "name": "Stackpath"
  },
  {
    "id": "syse",
    "credentialKeys": [
      "SYSE_CREDENTIALS",
      "SYSE_HTTP_TIMEOUT",
      "SYSE_POLLING_INTERVAL"
    ],
    "name": "Syse"
  },
  {
    "id": "technitium",
    "credentialKeys": [
      "TECHNITIUM_SERVER_BASE_URL"
    ],
    "name": "Technitium"
  },
  {
    "id": "tele3",
    "credentialKeys": [
      "TELE3_SECRET"
    ],
    "name": "Tele 3"
  },
  {
    "id": "tencentcloud",
    "credentialKeys": [
      "TENCENTCLOUD_SECRET_KEY"
    ],
    "name": "腾讯云"
  },
  {
    "id": "timewebcloud",
    "credentialKeys": [
      "TIMEWEBCLOUD_AUTH_TOKEN",
      "TIMEWEBCLOUD_HTTP_TIMEOUT",
      "TIMEWEBCLOUD_POLLING_INTERVAL"
    ],
    "name": "Timeweb Cloud"
  },
  {
    "id": "todaynic",
    "credentialKeys": [
      "TODAYNIC_AUTH_USER_ID"
    ],
    "name": "Todaynic"
  },
  {
    "id": "transip",
    "credentialKeys": [
      "TRANSIP_PRIVATE_KEY_PATH"
    ],
    "name": "Transip"
  },
  {
    "id": "ucloud",
    "credentialKeys": [
      "UCLOUD_PUBLIC_KEY"
    ],
    "name": "Ucloud"
  },
  {
    "id": "ultradns",
    "credentialKeys": [
      "ULTRADNS_USERNAME"
    ],
    "name": "Ultradns"
  },
  {
    "id": "uniteddomains",
    "credentialKeys": [
      "UNITEDDOMAINS_API_KEY",
      "UNITEDDOMAINS_HTTP_TIMEOUT",
      "UNITEDDOMAINS_POLLING_INTERVAL"
    ],
    "name": "Uniteddomains"
  },
  {
    "id": "variomedia",
    "credentialKeys": [
      "VARIOMEDIA_API_TOKEN",
      "VARIOMEDIA_HTTP_TIMEOUT",
      "VARIOMEDIA_POLLING_INTERVAL"
    ],
    "name": "Variomedia"
  },
  {
    "id": "veesp",
    "credentialKeys": [
      "VEESP_USERNAME"
    ],
    "name": "Veesp"
  },
  {
    "id": "vegadns",
    "credentialKeys": [
      "SECRET_VEGADNS_SECRET",
      "VEGADNS_URL"
    ],
    "name": "Vegadns"
  },
  {
    "id": "vercel",
    "credentialKeys": [
      "VERCEL_API_TOKEN",
      "VERCEL_HTTP_TIMEOUT",
      "VERCEL_POLLING_INTERVAL"
    ],
    "name": "Vercel"
  },
  {
    "id": "versio",
    "credentialKeys": [
      "VERSIO_USERNAME"
    ],
    "name": "Versio"
  },
  {
    "id": "vinyldns",
    "credentialKeys": [
      "VINYLDNS_HOST",
      "VINYLDNS_SECRET_KEY"
    ],
    "name": "Vinyldns"
  },
  {
    "id": "virtualname",
    "credentialKeys": [
      "VIRTUALNAME_TOKEN",
      "VIRTUALNAME_HTTP_TIMEOUT",
      "VIRTUALNAME_POLLING_INTERVAL"
    ],
    "name": "Virtualname"
  },
  {
    "id": "vkcloud",
    "credentialKeys": [
      "VK_CLOUD_PROJECT_ID",
      "VK_CLOUD_USERNAME"
    ],
    "name": "Vkcloud"
  },
  {
    "id": "volcengine",
    "credentialKeys": [
      "VOLC_SECRETKEY"
    ],
    "name": "Volcengine"
  },
  {
    "id": "vscale",
    "credentialKeys": [
      "VSCALE_API_TOKEN",
      "VSCALE_HTTP_TIMEOUT",
      "VSCALE_POLLING_INTERVAL"
    ],
    "name": "Vscale"
  },
  {
    "id": "vultr",
    "credentialKeys": [
      "VULTR_API_KEY",
      "VULTR_HTTP_TIMEOUT",
      "VULTR_POLLING_INTERVAL"
    ],
    "name": "Vultr"
  },
  {
    "id": "wannafind",
    "credentialKeys": [
      "WANNAFIND_API_KEY",
      "WANNAFIND_HTTP_TIMEOUT",
      "WANNAFIND_POLLING_INTERVAL"
    ],
    "name": "Wannafind"
  },
  {
    "id": "webnamesca",
    "credentialKeys": [
      "WEBNAMESCA_API_USER"
    ],
    "name": "Webnamesca"
  },
  {
    "id": "webnamesru",
    "credentialKeys": [
      "WEBNAMESRU_API_KEY",
      "WEBNAMESRU_HTTP_TIMEOUT",
      "WEBNAMESRU_POLLING_INTERVAL"
    ],
    "name": "Webnamesru"
  },
  {
    "id": "websupport",
    "credentialKeys": [
      "WEBSUPPORT_SECRET"
    ],
    "name": "Websupport"
  },
  {
    "id": "wedos",
    "credentialKeys": [
      "WEDOS_WAPI_PASSWORD"
    ],
    "name": "Wedos"
  },
  {
    "id": "westcn",
    "credentialKeys": [
      "WESTCN_USERNAME"
    ],
    "name": "Westcn"
  },
  {
    "id": "xinnet",
    "credentialKeys": [
      "XINNET_SECRET"
    ],
    "name": "Xinnet"
  },
  {
    "id": "yandex",
    "credentialKeys": [
      "YANDEX_PDD_TOKEN",
      "YANDEX_HTTP_TIMEOUT",
      "YANDEX_POLLING_INTERVAL"
    ],
    "name": "Yandex"
  },
  {
    "id": "yandex360",
    "credentialKeys": [
      "YANDEX360_ORG_ID"
    ],
    "name": "Yandex 360"
  },
  {
    "id": "yandexcloud",
    "credentialKeys": [
      "YANDEX_CLOUD_IAM_TOKEN"
    ],
    "name": "Yandexcloud"
  },
  {
    "id": "zilore",
    "credentialKeys": [
      "ZILORE_ACCESS_KEY",
      "ZILORE_HTTP_TIMEOUT",
      "ZILORE_POLLING_INTERVAL"
    ],
    "name": "Zilore"
  },
  {
    "id": "zoneedit",
    "credentialKeys": [
      "ZONEEDIT_USER"
    ],
    "name": "Zoneedit"
  },
  {
    "id": "zoneee",
    "credentialKeys": [
      "ZONEEE_API_USER"
    ],
    "name": "Zoneee"
  },
  {
    "id": "zonomi",
    "credentialKeys": [
      "ZONOMI_API_KEY",
      "ZONOMI_HTTP_TIMEOUT",
      "ZONOMI_POLLING_INTERVAL"
    ],
    "name": "Zonomi"
  }
];

const legoCredentialTemplateOverrides: Readonly<Record<string, string>> = Object.freeze({
  alidns: 'ALICLOUD_ACCESS_KEY=your-access-key\nALICLOUD_SECRET_KEY=your-secret-key',
  cloudflare: 'CLOUDFLARE_DNS_API_TOKEN=your-api-token',
});

export const acmeDnsProviderDefinitions: readonly AcmeDnsProviderDefinition[] = Object.freeze(
  legoProviderSeeds.map(({ id, name, credentialKeys }) => ({
    id,
    name,
    credentialKeys,
    credentialTemplate: legoCredentialTemplateOverrides[id] ?? credentialKeys.map((key) => `${key}=your-${key.toLowerCase().replaceAll('_', '-')}`).join('\n'),
  })),
);

export function listAcmeDnsProviders(): AcmeDnsProviderDefinition[] {
  return acmeDnsProviderDefinitions.map((provider) => ({ ...provider }));
}

export function findAcmeDnsProvider(id: string): AcmeDnsProviderDefinition | undefined {
  const provider = acmeDnsProviderDefinitions.find((item) => item.id === id);
  return provider ? { ...provider } : undefined;
}
