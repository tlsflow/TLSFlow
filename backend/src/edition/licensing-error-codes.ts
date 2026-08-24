export const editionLicensingErrorCodes = {
  LICENSE_NOT_CONFIGURED: { httpStatus: 409, message: '尚未配置有效许可证' },
  LICENSE_INVALID: { httpStatus: 422, message: '许可证无效' },
  LICENSE_TAMPERED: { httpStatus: 422, message: '许可证签名无效，文件可能已被修改' },
  LICENSE_INSTANCE_MISMATCH: { httpStatus: 422, message: '许可证与当前安装实例不匹配' },
  LICENSE_DEVICE_MISMATCH: { httpStatus: 422, message: '许可证与当前设备标识不匹配' },
  LICENSE_REVOKED: { httpStatus: 403, message: '许可证已撤销' },
  LICENSE_FEATURE_DENIED: { httpStatus: 403, message: '当前套餐未包含该功能' },
  LICENSE_QUOTA_EXCEEDED: { httpStatus: 403, message: '已超过许可证额度' },
  LICENSE_UPGRADE_GRACE_EXPIRED: { httpStatus: 403, message: '产品版本升级宽限期已结束' },
  LICENSE_CLOCK_ROLLBACK: { httpStatus: 409, message: '检测到系统时间回退' },
} as const;
