package com.tidecanvas.service;

import com.tidecanvas.common.PageResult;
import com.tidecanvas.enums.PointsTransactionTypeEnum;
import com.tidecanvas.model.query.PointsTransactionQuery;
import com.tidecanvas.model.vo.PointsBalanceVO;
import com.tidecanvas.model.vo.PointsTransactionVO;

/**
 * 积分服务接口
 *
 * @author tidecanvas
 */
public interface PointsService {

    /**
     * 增加积分
     *
     * @param userId 用户ID
     * @param amount 积分数量
     * @param type   交易类型
     * @param bizId  业务ID
     * @param remark 备注
     */
    void addPoints(Long userId, int amount, PointsTransactionTypeEnum type, Long bizId, String remark);

    /**
     * 扣减积分
     *
     * @param userId 用户ID
     * @param amount 积分数量
     * @param type   交易类型
     * @param bizId  业务ID
     * @param remark 备注
     */
    void deductPoints(Long userId, int amount, PointsTransactionTypeEnum type, Long bizId, String remark);

    /**
     * 查询积分余额
     *
     * @param userId 用户ID
     * @return 积分余额信息
     */
    PointsBalanceVO getBalance(Long userId);

    /**
     * 分页查询用户积分交易记录
     *
     * @param userId 用户ID
     * @param query  查询条件
     * @return 分页结果
     */
    PageResult<PointsTransactionVO> listTransactions(Long userId, PointsTransactionQuery query);

    /**
     * 分页查询所有积分交易记录（管理端）
     *
     * @param query 查询条件
     * @return 分页结果
     */
    PageResult<PointsTransactionVO> listAllTransactions(PointsTransactionQuery query);
}
