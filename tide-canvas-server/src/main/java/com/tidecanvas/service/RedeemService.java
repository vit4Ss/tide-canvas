package com.tidecanvas.service;

import com.tidecanvas.common.PageResult;
import com.tidecanvas.model.dto.GenerateRedeemDTO;
import com.tidecanvas.model.query.RedeemCodeQuery;
import com.tidecanvas.model.vo.RedeemCodeVO;
import com.tidecanvas.model.vo.RedeemResultVO;

import java.util.List;

/**
 * 兑换码服务。
 *
 * @author tidecanvas
 */
public interface RedeemService {

    /** 用户兑换：校验码并发放积分 */
    RedeemResultVO redeem(Long userId, String code);

    /** 管理端批量生成兑换码，返回生成的码列表 */
    List<String> generate(GenerateRedeemDTO dto);

    /** 管理端分页查询 */
    PageResult<RedeemCodeVO> list(RedeemCodeQuery query);

    /** 启用(0)/停用(2) */
    void updateStatus(Long id, Integer status);

    void delete(Long id);
}
