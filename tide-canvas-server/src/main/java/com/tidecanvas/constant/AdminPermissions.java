package com.tidecanvas.constant;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 后台权限目录（操作按钮级）。每个后台操作一个权限码，按模块分组，供角色编辑与校验使用。
 *
 * @author tidecanvas
 */
public final class AdminPermissions {

    private AdminPermissions() {
    }

    /** 通配：拥有全部权限 */
    public static final String WILDCARD = "*";

    public record Item(String code, String label) {
    }

    public record Group(String group, List<Item> items) {
    }

    public static final List<Group> CATALOG = List.of(
            new Group("概览", List.of(
                    new Item("dashboard:view", "数据面板"),
                    new Item("monitor:view", "监控总览"))),
            new Group("用户与内容", List.of(
                    new Item("user:view", "用户-查看"),
                    new Item("user:edit", "用户-编辑"),
                    new Item("content:view", "内容-查看"),
                    new Item("content:audit", "内容-审核"),
                    new Item("author:view", "作者-查看"),
                    new Item("author:manage", "作者-授予/撤销"),
                    new Item("banner:view", "Banner-查看"),
                    new Item("banner:manage", "Banner-增删改"),
                    new Item("file:view", "文件-查看"),
                    new Item("file:delete", "文件-删除"),
                    new Item("security:view", "封禁-查看"),
                    new Item("security:manage", "封禁-封禁/解封"))),
            new Group("营收", List.of(
                    new Item("points:view", "积分-查看"),
                    new Item("points:adjust", "积分-调整"),
                    new Item("points:refund", "积分-退还"),
                    new Item("order:view", "订单-查看"),
                    new Item("order:pay", "订单-确认支付"),
                    new Item("redeem:view", "兑换码-查看"),
                    new Item("redeem:generate", "兑换码-生成"),
                    new Item("redeem:update", "兑换码-启停"),
                    new Item("redeem:delete", "兑换码-删除"))),
            new Group("AI", List.of(
                    new Item("provider:view", "供应商-查看"),
                    new Item("provider:manage", "供应商-增删改"),
                    new Item("model:view", "模型-查看"),
                    new Item("model:manage", "模型-增删改"),
                    new Item("handler:view", "Handler-查看"),
                    new Item("handler:manage", "Handler-配置"),
                    new Item("ailog:view", "AI日志-查看"))),
            new Group("系统", List.of(
                    new Item("email:view", "邮件模板-查看"),
                    new Item("email:edit", "邮件模板-编辑"),
                    new Item("setting:view", "系统设置-查看"),
                    new Item("setting:edit", "系统设置-编辑"),
                    new Item("role:view", "角色-查看"),
                    new Item("role:manage", "角色-管理"))),
            new Group("日志", List.of(
                    new Item("syslog:view", "系统日志-查看"),
                    new Item("syslog:delete", "系统日志-删除"),
                    new Item("accesslog:view", "访问日志-查看"),
                    new Item("accesslog:delete", "访问日志-删除"),
                    new Item("loginlog:view", "登录日志-查看"),
                    new Item("loginlog:delete", "登录日志-删除"))));

    /** 全部合法权限码 */
    public static final Set<String> ALL_CODES = CATALOG.stream()
            .flatMap(g -> g.items().stream())
            .map(Item::code)
            .collect(Collectors.toUnmodifiableSet());
}
