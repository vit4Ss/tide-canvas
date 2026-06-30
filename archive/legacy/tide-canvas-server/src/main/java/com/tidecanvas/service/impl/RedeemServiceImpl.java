package com.tidecanvas.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.enums.PointsTransactionTypeEnum;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.RedeemCodeMapper;
import com.tidecanvas.model.dto.GenerateRedeemDTO;
import com.tidecanvas.model.entity.RedeemCodeDO;
import com.tidecanvas.model.query.RedeemCodeQuery;
import com.tidecanvas.model.vo.PointsBalanceVO;
import com.tidecanvas.model.vo.RedeemCodeVO;
import com.tidecanvas.model.vo.RedeemResultVO;
import com.tidecanvas.security.SecurityUserDetails;
import com.tidecanvas.security.SecurityUtils;
import com.tidecanvas.service.PointsService;
import com.tidecanvas.service.RedeemService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 兑换码服务实现。
 *
 * @author tidecanvas
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RedeemServiceImpl implements RedeemService {

    private final RedeemCodeMapper redeemMapper;
    private final PointsService pointsService;

    /** 去掉易混字符 I/L/O/0/1 */
    private static final String CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    private static final int CODE_LEN = 12;
    private final SecureRandom random = new SecureRandom();

    @Override
    @Transactional(rollbackFor = Exception.class)
    public RedeemResultVO redeem(Long userId, String code) {
        if (!StringUtils.hasText(code)) {
            throw new BusinessException(ResultCode.REDEEM_CODE_INVALID);
        }
        String normalized = code.trim().toUpperCase();
        // 悲观锁锁定该码行，防止并发重复兑换
        RedeemCodeDO rc = redeemMapper.selectOne(new LambdaQueryWrapper<RedeemCodeDO>()
                .eq(RedeemCodeDO::getCode, normalized)
                .last("FOR UPDATE"));
        if (rc == null) {
            throw new BusinessException(ResultCode.REDEEM_CODE_INVALID);
        }
        if (rc.getStatus() != null && rc.getStatus() == 2) {
            throw new BusinessException(ResultCode.REDEEM_CODE_DISABLED);
        }
        if (rc.getStatus() != null && rc.getStatus() == 1) {
            throw new BusinessException(ResultCode.REDEEM_CODE_USED);
        }
        if (rc.getExpireTime() != null && rc.getExpireTime().isBefore(LocalDateTime.now())) {
            throw new BusinessException(ResultCode.REDEEM_CODE_EXPIRED);
        }
        // 标记已用
        rc.setStatus(1);
        rc.setUsedBy(userId);
        rc.setUsedTime(LocalDateTime.now());
        redeemMapper.updateById(rc);
        // 发放积分
        int amount = rc.getPoints() == null ? 0 : rc.getPoints();
        pointsService.addPoints(userId, amount, PointsTransactionTypeEnum.REDEEM, rc.getId(), "兑换码兑换: " + normalized);

        PointsBalanceVO balance = pointsService.getBalance(userId);
        RedeemResultVO result = new RedeemResultVO();
        result.setPoints(amount);
        result.setBalance(balance == null ? null : balance.getPoints());
        log.info("兑换成功: userId={}, code={}, points={}", userId, normalized, amount);
        return result;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public List<String> generate(GenerateRedeemDTO dto) {
        int count = dto.getCount() == null ? 1 : Math.min(Math.max(dto.getCount(), 1), 1000);
        int points = dto.getPoints() == null ? 0 : dto.getPoints();
        String batchNo = "B" + System.currentTimeMillis();
        // 记录生成者(当前管理员)ID
        SecurityUserDetails admin = SecurityUtils.getCurrentUser();
        Long creatorId = admin != null ? admin.getUserId() : null;
        List<String> codes = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            String code = uniqueCode();
            RedeemCodeDO rc = new RedeemCodeDO();
            rc.setCode(code);
            rc.setPoints(points);
            rc.setCreatedBy(creatorId);
            rc.setStatus(0);
            rc.setExpireTime(dto.getExpireTime());
            rc.setBatchNo(batchNo);
            rc.setRemark(dto.getRemark());
            rc.setDeleted(0);
            redeemMapper.insert(rc);
            codes.add(code);
        }
        log.info("生成兑换码: batch={}, count={}, points={}", batchNo, count, points);
        return codes;
    }

    private String uniqueCode() {
        for (int attempt = 0; attempt < 6; attempt++) {
            String code = randomCode();
            Long exist = redeemMapper.selectCount(new LambdaQueryWrapper<RedeemCodeDO>().eq(RedeemCodeDO::getCode, code));
            if (exist == null || exist == 0) {
                return code;
            }
        }
        // 极低概率兜底
        return randomCode() + (System.nanoTime() % 100);
    }

    private String randomCode() {
        StringBuilder sb = new StringBuilder(CODE_LEN);
        for (int i = 0; i < CODE_LEN; i++) {
            sb.append(CHARS.charAt(random.nextInt(CHARS.length())));
        }
        return sb.toString();
    }

    @Override
    public PageResult<RedeemCodeVO> list(RedeemCodeQuery query) {
        Page<RedeemCodeDO> page = new Page<>(query.getPageNum(), query.getPageSize());
        LambdaQueryWrapper<RedeemCodeDO> wrapper = new LambdaQueryWrapper<RedeemCodeDO>()
                .like(StringUtils.hasText(query.getCode()), RedeemCodeDO::getCode, query.getCode())
                .eq(query.getStatus() != null, RedeemCodeDO::getStatus, query.getStatus())
                .eq(StringUtils.hasText(query.getBatchNo()), RedeemCodeDO::getBatchNo, query.getBatchNo())
                .orderByDesc(RedeemCodeDO::getId);
        redeemMapper.selectPage(page, wrapper);
        List<RedeemCodeVO> records = page.getRecords().stream().map(d -> {
            RedeemCodeVO vo = new RedeemCodeVO();
            BeanUtils.copyProperties(d, vo);
            return vo;
        }).toList();
        return PageResult.of(records, page);
    }

    @Override
    public void updateStatus(Long id, Integer status) {
        RedeemCodeDO rc = redeemMapper.selectById(id);
        if (rc == null) {
            throw new BusinessException(ResultCode.NOT_FOUND);
        }
        rc.setStatus(status);
        redeemMapper.updateById(rc);
    }

    @Override
    public void delete(Long id) {
        redeemMapper.deleteById(id);
    }
}
