-- 历史 Citrix/NetScaler 标识只允许在本次递增迁移中出现；运行时统一使用插件稳定标识。
update pg_hosts host
set asset_fingerprint = 'device:citrix.netscaler-adc:' || lower(service.address) || ':' || device.management_port,
    updated_at = now(),
    version = host.version + 1
from pg_device_assets device
join pg_service_assets service
  on service.id = device.service_asset_id
 and service.tenant_id = device.tenant_id
where host.id = device.host_id
  and host.tenant_id = device.tenant_id
  and upper(regexp_replace(trim(device.device_family), '[^A-Za-z0-9]+', '_', 'g'))
      in ('CITRIX_ADC', 'NETSCALER_ADC', 'CITRIX_NETSCALER_ADC')
  and host.asset_fingerprint = 'device:' || device.device_family || ':' || lower(service.address) || ':' || device.management_port
  and host.asset_fingerprint is distinct from 'device:citrix.netscaler-adc:' || lower(service.address) || ':' || device.management_port;

update pg_service_assets service
set metadata = jsonb_set(service.metadata, '{deviceFamily}', to_jsonb('citrix.netscaler-adc'::text), true),
    updated_at = now(),
    version = service.version + 1
where upper(regexp_replace(trim(service.metadata->>'deviceFamily'), '[^A-Za-z0-9]+', '_', 'g'))
      in ('CITRIX_ADC', 'NETSCALER_ADC', 'CITRIX_NETSCALER_ADC')
  and service.metadata->>'deviceFamily' is distinct from 'citrix.netscaler-adc';

update pg_device_assets device
set device_family = case
      when upper(regexp_replace(trim(device.device_family), '[^A-Za-z0-9]+', '_', 'g'))
           in ('CITRIX_ADC', 'NETSCALER_ADC', 'CITRIX_NETSCALER_ADC')
        then 'citrix.netscaler-adc'
      else device.device_family
    end,
    product_family = case
      when upper(regexp_replace(trim(coalesce(device.product_family, '')), '[^A-Za-z0-9]+', '_', 'g'))
           in ('CITRIX_ADC', 'NETSCALER_ADC', 'CITRIX_NETSCALER_ADC')
        then 'citrix.netscaler-adc'
      else device.product_family
    end,
    product_name = case
      when upper(regexp_replace(trim(coalesce(device.product_name, '')), '[^A-Za-z0-9]+', '_', 'g'))
           in ('CITRIX_ADC', 'NETSCALER_ADC', 'CITRIX_NETSCALER_ADC')
        then 'citrix.netscaler-adc'
      else device.product_name
    end,
    updated_at = now(),
    version = device.version + 1
where (
    upper(regexp_replace(trim(device.device_family), '[^A-Za-z0-9]+', '_', 'g'))
      in ('CITRIX_ADC', 'NETSCALER_ADC', 'CITRIX_NETSCALER_ADC')
    and device.device_family is distinct from 'citrix.netscaler-adc'
  ) or (
    upper(regexp_replace(trim(coalesce(device.product_family, '')), '[^A-Za-z0-9]+', '_', 'g'))
      in ('CITRIX_ADC', 'NETSCALER_ADC', 'CITRIX_NETSCALER_ADC')
    and device.product_family is distinct from 'citrix.netscaler-adc'
  ) or (
    upper(regexp_replace(trim(coalesce(device.product_name, '')), '[^A-Za-z0-9]+', '_', 'g'))
      in ('CITRIX_ADC', 'NETSCALER_ADC', 'CITRIX_NETSCALER_ADC')
    and device.product_name is distinct from 'citrix.netscaler-adc'
  );
