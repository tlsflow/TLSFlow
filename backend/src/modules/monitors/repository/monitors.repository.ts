export interface MonitorsRepository {
  // 业务 Repository 由 027 实现。这里保留接口边界，禁止 Controller 直接访问数据库。
  readonly moduleName: 'monitors';
}
