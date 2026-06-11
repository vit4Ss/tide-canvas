package com.tidecanvas.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.enums.PointsTransactionTypeEnum;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.CheckinRecordMapper;
import com.tidecanvas.mapper.PointsTransactionMapper;
import com.tidecanvas.mapper.SysUserMapper;
import com.tidecanvas.model.entity.CheckinRecordDO;
import com.tidecanvas.model.entity.PointsTransactionDO;
import com.tidecanvas.model.entity.SysUserDO;
import com.tidecanvas.model.query.PointsTransactionQuery;
import com.tidecanvas.model.vo.PointsBalanceVO;
import com.tidecanvas.model.vo.PointsTransactionVO;
import com.tidecanvas.service.PointsService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class PointsServiceImpl implements PointsService {

    private final SysUserMapper userMapper;
    private final PointsTransactionMapper transactionMapper;
    private final CheckinRecordMapper checkinRecordMapper;

    private static final DateTimeFormatter DATE_TIME_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void addPoints(Long userId, int amount, PointsTransactionTypeEnum type, Long bizId, String remark) {
        assertPositiveAmount(amount);
        SysUserDO user = userMapper.selectForUpdate(userId);
        if (user == null) {
            throw new BusinessException(ResultCode.ACCOUNT_NOT_FOUND);
        }
        userMapper.update(null, new UpdateWrapper<SysUserDO>()
                .setSql("points = points + " + amount)
                .eq("id", userId));

        int balanceAfter = user.getPoints() + amount;
        insertTransaction(userId, amount, balanceAfter, type, bizId, remark);
        log.info("Points added: userId={}, amount={}, type={}, balanceAfter={}",
                userId, amount, type.getDesc(), balanceAfter);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deductPoints(Long userId, int amount, PointsTransactionTypeEnum type, Long bizId, String remark) {
        assertPositiveAmount(amount);
        SysUserDO user = userMapper.selectForUpdate(userId);
        if (user == null) {
            throw new BusinessException(ResultCode.ACCOUNT_NOT_FOUND);
        }
        if (user.getPoints() < amount) {
            throw new BusinessException(ResultCode.POINTS_INSUFFICIENT);
        }

        userMapper.update(null, new UpdateWrapper<SysUserDO>()
                .setSql("points = points - " + amount)
                .eq("id", userId));

        int balanceAfter = user.getPoints() - amount;
        insertTransaction(userId, -amount, balanceAfter, type, bizId, remark);
        log.info("Points deducted: userId={}, amount={}, type={}, balanceAfter={}",
                userId, amount, type.getDesc(), balanceAfter);
    }

    @Override
    public PointsBalanceVO getBalance(Long userId) {
        SysUserDO user = requireUser(userId);
        LocalDate today = LocalDate.now();
        Long checkinCount = checkinRecordMapper.selectCount(
                new LambdaQueryWrapper<CheckinRecordDO>()
                        .eq(CheckinRecordDO::getUserId, userId)
                        .eq(CheckinRecordDO::getCheckinDate, today));

        PointsBalanceVO vo = new PointsBalanceVO();
        vo.setPoints(user.getPoints());
        vo.setTodayCheckedIn(checkinCount > 0);
        return vo;
    }

    @Override
    public PageResult<PointsTransactionVO> listTransactions(Long userId, PointsTransactionQuery query) {
        Page<PointsTransactionDO> page = new Page<>(query.getPageNum(), query.getPageSize());
        LambdaQueryWrapper<PointsTransactionDO> wrapper = baseQuery(query)
                .eq(PointsTransactionDO::getUserId, userId);
        transactionMapper.selectPage(page, wrapper);
        return PageResult.of(page.getRecords().stream().map(this::toTransactionVO).toList(), page);
    }

    @Override
    public PageResult<PointsTransactionVO> listAllTransactions(PointsTransactionQuery query) {
        Page<PointsTransactionDO> page = new Page<>(query.getPageNum(), query.getPageSize());
        LambdaQueryWrapper<PointsTransactionDO> wrapper = baseQuery(query)
                .eq(query.getUserId() != null, PointsTransactionDO::getUserId, query.getUserId());
        transactionMapper.selectPage(page, wrapper);
        return PageResult.of(page.getRecords().stream().map(this::toTransactionVO).toList(), page);
    }

    private LambdaQueryWrapper<PointsTransactionDO> baseQuery(PointsTransactionQuery query) {
        return new LambdaQueryWrapper<PointsTransactionDO>()
                .eq(query.getType() != null, PointsTransactionDO::getType, query.getType())
                .ge(StringUtils.hasText(query.getStartTime()), PointsTransactionDO::getCreateTime,
                        StringUtils.hasText(query.getStartTime()) ? LocalDateTime.parse(query.getStartTime(), DATE_TIME_FORMATTER) : null)
                .le(StringUtils.hasText(query.getEndTime()), PointsTransactionDO::getCreateTime,
                        StringUtils.hasText(query.getEndTime()) ? LocalDateTime.parse(query.getEndTime(), DATE_TIME_FORMATTER) : null)
                .orderByDesc(PointsTransactionDO::getCreateTime);
    }

    private void assertPositiveAmount(int amount) {
        if (amount <= 0) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "积分变动金额必须大于0");
        }
    }

    private SysUserDO requireUser(Long userId) {
        SysUserDO user = userMapper.selectById(userId);
        if (user == null) {
            throw new BusinessException(ResultCode.ACCOUNT_NOT_FOUND);
        }
        return user;
    }

    private void insertTransaction(Long userId, int amount, int balanceAfter,
                                   PointsTransactionTypeEnum type, Long bizId, String remark) {
        PointsTransactionDO transaction = new PointsTransactionDO();
        transaction.setUserId(userId);
        transaction.setAmount(amount);
        transaction.setBalanceAfter(balanceAfter);
        transaction.setType(type.getCode());
        transaction.setBizId(bizId);
        transaction.setRemark(remark);
        transaction.setDeleted(0);
        transactionMapper.insert(transaction);
    }

    private PointsTransactionVO toTransactionVO(PointsTransactionDO transaction) {
        PointsTransactionVO vo = new PointsTransactionVO();
        vo.setId(transaction.getId());
        vo.setAmount(transaction.getAmount());
        vo.setBalanceAfter(transaction.getBalanceAfter());
        vo.setType(transaction.getType());
        vo.setBizId(transaction.getBizId());
        vo.setRemark(transaction.getRemark());
        vo.setCreateTime(transaction.getCreateTime());

        PointsTransactionTypeEnum typeEnum = PointsTransactionTypeEnum.of(transaction.getType());
        vo.setTypeName(typeEnum != null ? typeEnum.getDesc() : "未知");
        return vo;
    }
}
