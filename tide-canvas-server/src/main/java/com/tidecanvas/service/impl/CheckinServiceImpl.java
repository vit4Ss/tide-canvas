package com.tidecanvas.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.enums.PointsTransactionTypeEnum;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.CheckinRecordMapper;
import com.tidecanvas.mapper.SysConfigMapper;
import com.tidecanvas.model.entity.CheckinRecordDO;
import com.tidecanvas.model.entity.SysConfigDO;
import com.tidecanvas.model.vo.CheckinCalendarVO;
import com.tidecanvas.model.vo.CheckinStatusVO;
import com.tidecanvas.service.CheckinService;
import com.tidecanvas.service.PointsService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * 签到服务实现类
 *
 * @author tidecanvas
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CheckinServiceImpl implements CheckinService {

    private final CheckinRecordMapper checkinRecordMapper;
    private final SysConfigMapper configMapper;
    private final PointsService pointsService;

    /** 签到基础积分配置key */
    private static final String CONFIG_CHECKIN_BASE = "points.checkin.base";
    /** 连续签到每日额外奖励配置key */
    private static final String CONFIG_CHECKIN_STREAK_BONUS = "points.checkin.streak.bonus";
    /** 连续签到奖励上限配置key */
    private static final String CONFIG_CHECKIN_STREAK_CAP = "points.checkin.streak.cap";

    /** 默认基础签到积分 */
    private static final int DEFAULT_CHECKIN_BASE = 10;
    /** 默认连续签到每日额外积分 */
    private static final int DEFAULT_STREAK_BONUS = 2;
    /** 默认连续签到奖励上限 */
    private static final int DEFAULT_STREAK_CAP = 20;

    private static final DateTimeFormatter DATE_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    @Override
    @Transactional(rollbackFor = Exception.class)
    public CheckinStatusVO checkin(Long userId) {
        LocalDate today = LocalDate.now();

        // 检查今日是否已签到
        CheckinRecordDO todayRecord = getTodayRecord(userId, today);
        if (todayRecord != null) {
            throw new BusinessException(ResultCode.ALREADY_CHECKED_IN);
        }

        // 计算连续签到天数
        LocalDate yesterday = today.minusDays(1);
        CheckinRecordDO yesterdayRecord = checkinRecordMapper.selectOne(
                new LambdaQueryWrapper<CheckinRecordDO>()
                        .eq(CheckinRecordDO::getUserId, userId)
                        .eq(CheckinRecordDO::getCheckinDate, yesterday));

        int streakDays = (yesterdayRecord != null) ? yesterdayRecord.getStreakDays() + 1 : 1;

        // 从配置中读取积分参数
        int basePoints = getConfigInt(CONFIG_CHECKIN_BASE, DEFAULT_CHECKIN_BASE);
        int streakBonus = getConfigInt(CONFIG_CHECKIN_STREAK_BONUS, DEFAULT_STREAK_BONUS);
        int streakCap = getConfigInt(CONFIG_CHECKIN_STREAK_CAP, DEFAULT_STREAK_CAP);

        // 计算签到奖励积分: base + min(streakBonus * (streak - 1), cap)
        int bonusPoints = Math.min(streakBonus * (streakDays - 1), streakCap);
        int totalPoints = basePoints + bonusPoints;

        // 插入签到记录
        CheckinRecordDO record = new CheckinRecordDO();
        record.setUserId(userId);
        record.setCheckinDate(today);
        record.setStreakDays(streakDays);
        record.setPointsAwarded(totalPoints);
        record.setDeleted(0);
        checkinRecordMapper.insert(record);

        // 增加积分
        pointsService.addPoints(userId, totalPoints, PointsTransactionTypeEnum.CHECKIN, record.getId(), "每日签到");

        log.info("用户签到成功: userId={}, streakDays={}, pointsAwarded={}", userId, streakDays, totalPoints);

        // 构建返回结果
        CheckinStatusVO vo = new CheckinStatusVO();
        vo.setCheckedInToday(true);
        vo.setStreakDays(streakDays);
        vo.setPointsAwarded(totalPoints);
        return vo;
    }

    @Override
    public CheckinStatusVO getStatus(Long userId) {
        LocalDate today = LocalDate.now();
        CheckinRecordDO todayRecord = getTodayRecord(userId, today);

        CheckinStatusVO vo = new CheckinStatusVO();
        if (todayRecord != null) {
            vo.setCheckedInToday(true);
            vo.setStreakDays(todayRecord.getStreakDays());
            vo.setPointsAwarded(todayRecord.getPointsAwarded());
        } else {
            vo.setCheckedInToday(false);
            // 查询昨日记录以展示当前连续天数
            LocalDate yesterday = today.minusDays(1);
            CheckinRecordDO yesterdayRecord = checkinRecordMapper.selectOne(
                    new LambdaQueryWrapper<CheckinRecordDO>()
                            .eq(CheckinRecordDO::getUserId, userId)
                            .eq(CheckinRecordDO::getCheckinDate, yesterday));
            vo.setStreakDays(yesterdayRecord != null ? yesterdayRecord.getStreakDays() : 0);
            vo.setPointsAwarded(0);
        }
        return vo;
    }

    @Override
    public CheckinCalendarVO getCalendar(Long userId, int year, int month) {
        LocalDate startDate = LocalDate.of(year, month, 1);
        LocalDate endDate = startDate.plusMonths(1).minusDays(1);

        List<CheckinRecordDO> records = checkinRecordMapper.selectList(
                new LambdaQueryWrapper<CheckinRecordDO>()
                        .eq(CheckinRecordDO::getUserId, userId)
                        .ge(CheckinRecordDO::getCheckinDate, startDate)
                        .le(CheckinRecordDO::getCheckinDate, endDate)
                        .orderByAsc(CheckinRecordDO::getCheckinDate));

        List<String> dates = records.stream()
                .map(r -> r.getCheckinDate().format(DATE_FORMATTER))
                .toList();

        CheckinCalendarVO vo = new CheckinCalendarVO();
        vo.setDates(dates);
        return vo;
    }

    /**
     * 查询用户今日签到记录
     */
    private CheckinRecordDO getTodayRecord(Long userId, LocalDate today) {
        return checkinRecordMapper.selectOne(
                new LambdaQueryWrapper<CheckinRecordDO>()
                        .eq(CheckinRecordDO::getUserId, userId)
                        .eq(CheckinRecordDO::getCheckinDate, today));
    }

    /**
     * 从sys_config中读取整型配置，未配置时返回默认值
     */
    private int getConfigInt(String configKey, int defaultValue) {
        SysConfigDO config = configMapper.selectOne(
                new LambdaQueryWrapper<SysConfigDO>()
                        .eq(SysConfigDO::getConfigKey, configKey));
        if (config == null || config.getConfigValue() == null) {
            return defaultValue;
        }
        try {
            return Integer.parseInt(config.getConfigValue());
        } catch (NumberFormatException e) {
            log.warn("配置项解析失败: key={}, value={}, 使用默认值: {}", configKey, config.getConfigValue(), defaultValue);
            return defaultValue;
        }
    }
}
