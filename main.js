const CONSTANTS = {
    ELECTRICITY: {
        MIN_VALUE: 0,
        MAX_VALUE: 1000,
        SUFFICIENT_THRESHOLD: 100,
        LOW_THRESHOLD: 10,
        MAX_DAILY_CONSUMPTION: 50
    },
    TIME: {
        TWO_WEEKS_MS: 14 * 24 * 60 * 60 * 1000,
        ONE_DAY_MS: 24 * 60 * 60 * 1000,
        CONTINUOUS_DAY_THRESHOLD: 1.5
    },
    CHART: {
        DEFAULT_ZOOM_DELTA: 10
    }
};


const ValidationUtils = {
    isValidNumber(value, min = -Infinity, max = Infinity) {
        return typeof value === 'number' &&
               !isNaN(value) &&
               isFinite(value) &&
               value >= min &&
               value <= max;
    },

    isValidArray(arr, minLength = 0) {
        return Array.isArray(arr) && arr.length >= minLength;
    },

    isValidTimeString(timeStr) {
        return typeof timeStr === 'string' &&
               /^\d{1,2}-\d{1,2}(\s+\d{1,2}:\d{1,2}(:\d{1,2})?)?$/.test(timeStr.trim());
    },

    sanitizeElectricityValue(value) {
        if (!this.isValidNumber(value, CONSTANTS.ELECTRICITY.MIN_VALUE, CONSTANTS.ELECTRICITY.MAX_VALUE)) {
            console.warn(`无效的电量值: ${value}, 使用默认值 0`);
            return 0;
        }
        return Math.round(value * 100) / 100;
    }
};

const MathUtils = {
    safeDivide(numerator, denominator, fallback = 0) {
        if (!ValidationUtils.isValidNumber(numerator) ||
            !ValidationUtils.isValidNumber(denominator) ||
            denominator === 0) {
            return fallback;
        }
        return numerator / denominator;
    },

    clamp(value, min, max) {
        if (!ValidationUtils.isValidNumber(value)) return min;
        return Math.max(min, Math.min(max, value));
    },

    safeMax(values, fallback = 0) {
        if (!ValidationUtils.isValidArray(values, 1)) return fallback;
        const validValues = values.filter(v => ValidationUtils.isValidNumber(v));
        if (validValues.length === 0) return fallback;
        return Math.max(...validValues);
    },

    safeMin(values, fallback = 0) {
        if (!ValidationUtils.isValidArray(values, 1)) return fallback;
        const validValues = values.filter(v => ValidationUtils.isValidNumber(v));
        if (validValues.length === 0) return fallback;
        return Math.min(...validValues);
    }
};

const themeToggle = document.getElementById('theme-toggle');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
let isDark = localStorage.getItem('theme') === 'dark' || (localStorage.getItem('theme') === null && prefersDark);

let chartLight = null;
let chartAc = null;

function setTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    isDark = dark;
    if (chartLight && chartAc) {
        updateChartsTheme();
    }
}

setTheme(isDark);
themeToggle.addEventListener('click', () => {
    setTheme(!isDark);
    showToast(isDark ? '已切换到深色模式' : '已切换到浅色模式');
});

let toastTimer = null;

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast toast-${type} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

chartLight = echarts.init(document.getElementById('chart-light'));
chartAc = echarts.init(document.getElementById('chart-ac'));
let currentChartType = 'area';
let rawData = [];
let currentDataMonth = null;

function getChartColors() {
    const style = getComputedStyle(document.documentElement);
    return {
        text: style.getPropertyValue('--text-primary').trim() || '#1e293b',
        textSecondary: style.getPropertyValue('--text-secondary').trim() || '#64748b',
        border: style.getPropertyValue('--border-color').trim() || '#e2e8f0',
        cardBg: style.getPropertyValue('--card-bg').trim() || '#ffffff',
        light: '#3b82f6',
        lightGradient: ['rgba(59, 130, 246, 0.4)', 'rgba(59, 130, 246, 0.05)'],
        ac: '#10b981',
        acGradient: ['rgba(16, 185, 129, 0.4)', 'rgba(16, 185, 129, 0.05)']
    };
}

function getChartOption(title, color, gradientColors, data, type = 'line') {
    const colors = getChartColors();

    const seriesConfig = {
        line: {
            type: 'line',
            smooth: true,
            symbol: 'circle',
            symbolSize: 6,
            lineStyle: { width: 3, color: color },
            itemStyle: { color: color, borderWidth: 2, borderColor: '#fff' },
            areaStyle: {
                color: {
                    type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                    colorStops: [
                        { offset: 0, color: gradientColors[0] },
                        { offset: 1, color: gradientColors[1] }
                    ]
                }
            }
        },
        bar: {
            type: 'bar',
            barWidth: '60%',
            itemStyle: {
                color: {
                    type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                    colorStops: [
                        { offset: 0, color: color },
                        { offset: 1, color: gradientColors[0] }
                    ]
                },
                borderRadius: [4, 4, 0, 0]
            }
        },
        area: {
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 2, color: color },
            areaStyle: {
                color: {
                    type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                    colorStops: [
                        { offset: 0, color: gradientColors[0] },
                        { offset: 1, color: gradientColors[1] }
                    ]
                }
            }
        }
    };

    return {
        title: {
            show: false
        },
        tooltip: {
            trigger: 'axis',
            backgroundColor: colors.cardBg,
            borderColor: colors.border,
            borderWidth: 1,
            textStyle: { color: colors.text },
            formatter: params => {
                const date = new Date(params[0].value[0]);
                const timeStr = date.toLocaleString('zh-CN', {
                    month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit'
                });
                return `<div style="font-weight:600">${timeStr}</div>
                        <div style="margin-top:4px">
                            <span style="display:inline-block;width:10px;height:10px;background:${color};border-radius:50%;margin-right:6px"></span>
                            ${params[0].value[1].toFixed(2)} kWh
                        </div>`;
            }
        },
        grid: {
            left: '3%', right: '4%', bottom: '15%', top: '8%',
            containLabel: true
        },
        xAxis: {
            type: 'time',
            axisLine: { lineStyle: { color: colors.border } },
            axisLabel: { color: colors.textSecondary, fontSize: 11 },
            splitLine: { show: false }
        },
        yAxis: {
            type: 'value',
            axisLine: { show: false },
            axisLabel: { color: colors.textSecondary },
            splitLine: { lineStyle: { color: colors.border, type: 'dashed' } }
        },
        series: [{
            name: title,
            data: data,
            ...seriesConfig[type]
        }],
        dataZoom: [
            {
                type: 'slider',
                xAxisIndex: 0,
                height: 24,
                bottom: 8,
                borderColor: 'transparent',
                backgroundColor: colors.border + '40',
                fillerColor: color + '30',
                handleStyle: { color: color },
                textStyle: { color: colors.textSecondary },
                brushSelect: false
            },
            { type: 'inside', xAxisIndex: 0 }
        ],
        animation: true,
        animationDuration: 1000,
        animationEasing: 'cubicOut'
    };
}

function updateChartsTheme() {
    if (rawData.length > 0) {
        renderCharts(rawData, currentChartType, currentDataMonth);
    }
}

function interpolateMissingData(dataArray) {
    const processed = dataArray.map(record => ({ ...record }));
    ['light_Balance', 'ac_Balance'].forEach(field => {
        for (let i = 0; i < processed.length; i++) {
            if (processed[i][field] == null) {
                let prev = i - 1;
                while (prev >= 0 && processed[prev][field] == null) prev--;
                let next = i + 1;
                while (next < processed.length && processed[next][field] == null) next++;
                if (prev >= 0 && next < processed.length) {
                    const step = (processed[next][field] - processed[prev][field]) / (next - prev);
                    processed[i][field] = processed[prev][field] + step * (i - prev);
                } else if (prev >= 0) {
                    processed[i][field] = processed[prev][field];
                } else if (next < processed.length) {
                    processed[i][field] = processed[next][field];
                } else {
                    processed[i][field] = 0;
                }
            }
        }
    });
    return processed;
}

function getElectricityStatus(value, fullReference = CONSTANTS.ELECTRICITY.SUFFICIENT_THRESHOLD) {
    const normalizedValue = ValidationUtils.sanitizeElectricityValue(value);
    // 进度条按“相对历史最高余额”显示充盈度，而非把度数硬当百分比（基准不再拍脑袋）。
    const reference = fullReference > 0 ? fullReference : CONSTANTS.ELECTRICITY.SUFFICIENT_THRESHOLD;
    const percent = MathUtils.clamp((normalizedValue / reference) * 100, 0, 100);

    if (normalizedValue > CONSTANTS.ELECTRICITY.SUFFICIENT_THRESHOLD) {
        return { state: 'good', label: '充足', percent };
    }
    if (normalizedValue > CONSTANTS.ELECTRICITY.LOW_THRESHOLD) {
        return { state: 'warning', label: '偏低', percent };
    }
    return { state: 'danger', label: '不足', percent };
}

function setElectricityStatus(statusEl, progressEl, status) {
    statusEl.textContent = status.label;
    statusEl.dataset.state = status.state;
    statusEl.setAttribute('aria-label', status.label);
    progressEl.style.setProperty('--progress', `${status.percent}%`);
}

function getTrendState(value) {
    const numericValue = Number(value);
    if (numericValue > 0) return 'down';
    if (numericValue < 0) return 'up';
    return 'flat';
}

function formatConsumptionDelta(value) {
    const numericValue = Number(value);
    const safeValue = ValidationUtils.isValidNumber(numericValue) ? numericValue : 0;
    const sign = safeValue >= 0 ? '-' : '+';
    return `${sign}${Math.abs(safeValue).toFixed(1)}`;
}

function setConsumptionTrend(trendEl, value) {
    trendEl.dataset.trend = getTrendState(value);
    trendEl.querySelector('.trend-value').textContent = formatConsumptionDelta(value);
}

function getMonthContext(value) {
    return /^\d{4}-\d{2}$/.test(value) ? value : null;
}

function getRecordMonthContext(record, fallbackMonth = null) {
    return getMonthContext(record.month || '') || fallbackMonth;
}

function parseTimeString(timeStr, monthContext = null) {
    try {
        if (!ValidationUtils.isValidTimeString(timeStr)) {
            console.warn(`无效的时间格式: ${timeStr}`);
            return new Date(); // 返回当前时间作为兜底值。
        }

        const normalizedTime = timeStr.trim();
        const [datePart, clockPart = '00:00'] = normalizedTime.split(/\s+/);
        const [monthText, dayText] = datePart.split('-');
        const month = parseInt(monthText, 10);
        const day = parseInt(dayText, 10);

        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;

        if (month < 1 || month > 12 || day < 1 || day > 31) {
            console.warn(`无效的日期: ${datePart}`);
            return new Date();
        }

        const contextYear = monthContext ? parseInt(monthContext.split('-')[0], 10) : null;
        const year = contextYear || (month > currentMonth ? currentYear - 1 : currentYear);

        const dateStr = `${year}-${monthText.padStart(2, '0')}-${dayText.padStart(2, '0')}T${clockPart}`;
        const parsedDate = new Date(dateStr);

        if (isNaN(parsedDate.getTime())) {
            console.warn(`日期解析失败: ${dateStr}`);
            return new Date();
        }

        return parsedDate;
    } catch (error) {
        console.error('日期解析错误:', error.message);
        return new Date(); // 返回当前时间作为兜底值。
    }
}

function sortRecordsByTime(data, monthContext = null) {
    return data
        .map((record, index) => ({
            record,
            index,
            timestamp: parseTimeString(record.time, getRecordMonthContext(record, monthContext)).getTime()
        }))
        .sort((a, b) => (a.timestamp - b.timestamp) || (a.index - b.index))
        .map(item => item.record);
}

function calculateStats(data, monthContext = null) {
    if (!ValidationUtils.isValidArray(data, 2)) {
        console.warn('计算统计数据失败: 数据不足');
        return null;
    }

    try {
        const orderedData = sortRecordsByTime(data, monthContext);
        const parseRecordTime = record => parseTimeString(record.time, getRecordMonthContext(record, monthContext));
        const lightValues = orderedData.map(d => d.light_Balance).filter(v => v != null);
        const acValues = orderedData.map(d => d.ac_Balance).filter(v => v != null);

        const latest = orderedData[orderedData.length - 1];
        const latestTime = parseRecordTime(latest);

        const todayStart = new Date(latestTime);
        todayStart.setHours(0, 0, 0, 0);

        let todayFirstRecord = null;
        for (let i = 0; i < orderedData.length; i++) {
            const recordTime = parseRecordTime(orderedData[i]);
            if (recordTime >= todayStart) {
                todayFirstRecord = orderedData[i];
                break;
            }
        }

        const baseline = todayFirstRecord || (orderedData.length > 1 ? orderedData[orderedData.length - 2] : latest);

        const lastTime = parseRecordTime(latest);
        const twoWeeksAgo = new Date(lastTime.getTime() - CONSTANTS.TIME.TWO_WEEKS_MS);

        const recentData = orderedData.filter(d => {
            try {
                const t = parseRecordTime(d);
                return t >= twoWeeksAgo;
            } catch {
                return false;
            }
        });

        const calcData = recentData.length >= 2 ? recentData : orderedData;
        const firstRecord = calcData[0];
        const lastRecord = calcData[calcData.length - 1];
        const firstTime = parseRecordTime(firstRecord);
        const calcLastTime = parseRecordTime(lastRecord);
        const daysDiff = Math.max(1, (calcLastTime.getTime() - firstTime.getTime()) / CONSTANTS.TIME.ONE_DAY_MS);

        let lightTotalConsumption = 0;
        let acTotalConsumption = 0;
        for (let i = 1; i < calcData.length; i++) {
            const prevLight = ValidationUtils.sanitizeElectricityValue(calcData[i - 1].light_Balance || 0);
            const currLight = ValidationUtils.sanitizeElectricityValue(calcData[i].light_Balance || 0);
            const prevAc = ValidationUtils.sanitizeElectricityValue(calcData[i - 1].ac_Balance || 0);
            const currAc = ValidationUtils.sanitizeElectricityValue(calcData[i].ac_Balance || 0);
            if (prevLight > currLight) lightTotalConsumption += (prevLight - currLight);
            if (prevAc > currAc) acTotalConsumption += (prevAc - currAc);
        }

        const lightAvgDaily = MathUtils.safeDivide(lightTotalConsumption, daysDiff, 0).toFixed(1);
        const acAvgDaily = MathUtils.safeDivide(acTotalConsumption, daysDiff, 0).toFixed(1);

        const lightDaysLeft = parseFloat(lightAvgDaily) > 0
            ? Math.floor(MathUtils.safeDivide(latest.light_Balance || 0, parseFloat(lightAvgDaily), 0))
            : '∞';
        const acDaysLeft = parseFloat(acAvgDaily) > 0
            ? Math.floor(MathUtils.safeDivide(latest.ac_Balance || 0, parseFloat(acAvgDaily), 0))
            : '∞';

        const lightTrend = ((baseline.light_Balance || 0) - (latest.light_Balance || 0)).toFixed(1);
        const acTrend = ((baseline.ac_Balance || 0) - (latest.ac_Balance || 0)).toFixed(1);

        const yesterdayStart = new Date(todayStart);
        yesterdayStart.setDate(yesterdayStart.getDate() - 1);

        let yesterdayFirstRecord = null;
        for (let i = 0; i < orderedData.length; i++) {
            const recordTime = parseRecordTime(orderedData[i]);
            if (recordTime >= yesterdayStart && recordTime < todayStart) {
                yesterdayFirstRecord = orderedData[i];
                break;
            }
        }

        let lightYesterdayTrend = 0;
        let acYesterdayTrend = 0;
        if (yesterdayFirstRecord && baseline) {
            lightYesterdayTrend = Math.max(0, (yesterdayFirstRecord.light_Balance || 0) - (baseline.light_Balance || 0));
            acYesterdayTrend = Math.max(0, (yesterdayFirstRecord.ac_Balance || 0) - (baseline.ac_Balance || 0));
            lightYesterdayTrend = lightYesterdayTrend.toFixed(1);
            acYesterdayTrend = acYesterdayTrend.toFixed(1);
        }

        return {
            lightTrend: lightTrend,
            acTrend: acTrend,
            lightYesterdayTrend: lightYesterdayTrend,
            acYesterdayTrend: acYesterdayTrend,
            maxLight: MathUtils.safeMax(lightValues, 0).toFixed(1),
            minLight: MathUtils.safeMin(lightValues, 0).toFixed(1),
            maxAc: MathUtils.safeMax(acValues, 0).toFixed(1),
            minAc: MathUtils.safeMin(acValues, 0).toFixed(1),
            lightAvgDaily: lightAvgDaily,
            acAvgDaily: acAvgDaily,
            lightDaysLeft: lightDaysLeft,
            acDaysLeft: acDaysLeft,
            lastUpdate: latest.time,
            yesterdayTotalConsumption: (parseFloat(lightYesterdayTrend) + parseFloat(acYesterdayTrend)).toFixed(1)
        };
    } catch (error) {
        console.error('统计计算错误:', error);
        return null;
    }
}

function updateUI(data, monthContext = null) {
    if (data.length === 0) return;

    const orderedData = sortRecordsByTime(data, monthContext);
    const latest = orderedData[orderedData.length - 1];
    const lightValue = ValidationUtils.sanitizeElectricityValue(latest.light_Balance ?? 0);
    const acValue = ValidationUtils.sanitizeElectricityValue(latest.ac_Balance ?? 0);

    document.getElementById('light-value').textContent = lightValue.toFixed(1);
    document.getElementById('ac-value').textContent = acValue.toFixed(1);

    const lightValues = orderedData.map(d => d.light_Balance).filter(v => v != null);
    const acValues = orderedData.map(d => d.ac_Balance).filter(v => v != null);
    const lightFull = Math.max(MathUtils.safeMax(lightValues, 0), lightValue);
    const acFull = Math.max(MathUtils.safeMax(acValues, 0), acValue);

    const lightStatus = getElectricityStatus(lightValue, lightFull);
    const acStatus = getElectricityStatus(acValue, acFull);

    setElectricityStatus(
        document.getElementById('light-status'),
        document.getElementById('light-progress'),
        lightStatus
    );
    setElectricityStatus(
        document.getElementById('ac-status'),
        document.getElementById('ac-progress'),
        acStatus
    );

    const stats = calculateStats(orderedData, monthContext);
    if (stats) {
        const lightYesterdayTrendEl = document.getElementById('light-yesterday-trend');
        const acYesterdayTrendEl = document.getElementById('ac-yesterday-trend');

        setConsumptionTrend(lightYesterdayTrendEl, stats.lightYesterdayTrend);

        setConsumptionTrend(acYesterdayTrendEl, stats.acYesterdayTrend);

        const lightTrendEl = document.getElementById('light-trend');
        const acTrendEl = document.getElementById('ac-trend');

        setConsumptionTrend(lightTrendEl, stats.lightTrend);

        setConsumptionTrend(acTrendEl, stats.acTrend);

        document.getElementById('max-light').textContent = stats.maxLight;
        document.getElementById('min-light').textContent = stats.minLight;
        document.getElementById('max-ac').textContent = stats.maxAc;
        document.getElementById('min-ac').textContent = stats.minAc;
        document.getElementById('light-avg-daily').textContent = stats.lightAvgDaily;
        document.getElementById('ac-avg-daily').textContent = stats.acAvgDaily;
        document.getElementById('light-days-left').textContent = stats.lightDaysLeft + '天';
        document.getElementById('ac-days-left').textContent = stats.acDaysLeft + '天';
        document.getElementById('total-consumption').textContent = stats.yesterdayTotalConsumption + ' 度';
        document.getElementById('last-update').textContent = stats.lastUpdate;
    }
}

function renderCharts(data, type = 'line', monthContext = null) {
    const colors = getChartColors();

    const processedData = sortRecordsByTime(data, monthContext).map(e => ({
        ...e,
        timestamp: parseTimeString(e.time, getRecordMonthContext(e, monthContext)).getTime()
    }));

    const lightData = processedData.map(e => [e.timestamp, e.light_Balance]);
    const acData = processedData.map(e => [e.timestamp, e.ac_Balance]);

    chartLight.setOption(getChartOption('照明电量', colors.light, colors.lightGradient, lightData, type));
    chartAc.setOption(getChartOption('空调电量', colors.ac, colors.acGradient, acData, type));
}

async function fetchData(filepath) {
    const response = await fetch(filepath);
    if (!response.ok) {
        const error = new Error(`数据文件加载失败: ${filepath} (${response.status})`);
        error.status = response.status;
        error.filepath = filepath;
        error.isMissingDataFile = response.status === 404;
        throw error;
    }
    return response.json();
}

async function loadData() {
    try {
        const sel = document.getElementById('timeSplit').value;
        const data = await fetchData(`./data/${sel}.json`);
        currentDataMonth = getMonthContext(sel);
        rawData = interpolateMissingData(sortRecordsByTime(data, currentDataMonth));
        updateUI(rawData, currentDataMonth);
        renderCharts(rawData, currentChartType, currentDataMonth);
        showToast('数据加载成功', 'success');
    } catch (err) {
        if (err.isMissingDataFile) {
            console.info(err.message);
            showToast('暂无电量数据，等待首次更新', 'info');
            return;
        }
        console.error('加载错误:', err);
        showToast('数据加载失败', 'error');
    }
}

document.getElementById('timeSplit').addEventListener('change', loadData);
document.getElementById('refresh-btn').addEventListener('click', () => {
    document.getElementById('refresh-btn').classList.add('spinning');
    loadData().finally(() => {
        setTimeout(() => {
            document.getElementById('refresh-btn').classList.remove('spinning');
        }, 500);
    });
});

document.querySelectorAll('.btn-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.btn-toggle').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentChartType = btn.dataset.type;
        if (rawData.length > 0) {
            renderCharts(rawData, currentChartType, currentDataMonth);
        }
    });
});

document.querySelectorAll('[data-zoom]').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const action = e.target.dataset.zoom;
        const chart = e.target.closest('.chart-container').querySelector('.chart');
        const chartInstance = chart.id === 'chart-light' ? chartLight : chartAc;

        if (action === 'reset') {
            chartInstance.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
        } else {
            const option = chartInstance.getOption();
            const zoom = option.dataZoom[0];
            const delta = action === 'in' ? -CONSTANTS.CHART.DEFAULT_ZOOM_DELTA : CONSTANTS.CHART.DEFAULT_ZOOM_DELTA;
            const newStart = Math.max(0, zoom.start - delta / 2);
            const newEnd = Math.min(100, zoom.end + delta / 2);
            chartInstance.dispatchAction({ type: 'dataZoom', start: newStart, end: newEnd });
        }
    });
});

fetchData('./data/time.json').then(timeData => {
    const sel = document.getElementById('timeSplit');
    timeData.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.text = v;
        sel.add(opt);
    });
    loadData();
}).catch(() => {
    loadData();
});
const reportModal = document.getElementById('report-modal');
const reportBtn = document.getElementById('report-btn');
const modalClose = document.getElementById('modal-close');
const reportModalOverlay = reportModal.querySelector('.modal-overlay');
const exportBtn = document.getElementById('export-btn');
const yearSelect = document.getElementById('report-year-select');

let chartDaily = null;
let chartMonthly = null;
let chartHeatmap = null;
let yearlyData = {};

reportBtn.addEventListener('click', async () => {
    reportModal.classList.add('show');
    document.body.classList.add('modal-open');
    await initYearSelect();
});

function closeModal() {
    reportModal.classList.remove('show');
    document.body.classList.remove('modal-open');
}

modalClose.addEventListener('click', closeModal);
reportModalOverlay.addEventListener('click', closeModal);

yearSelect.addEventListener('change', async () => {
    await loadYearlyReport(parseInt(yearSelect.value));
});

async function initYearSelect() {
    try {
        const timeList = await fetchData('./data/time.json');

        const years = [...new Set(timeList.map(m => m.split('-')[0]))].sort().reverse();

        yearSelect.innerHTML = '';
        years.forEach(year => {
            const opt = document.createElement('option');
            opt.value = year;
            opt.text = year;
            yearSelect.add(opt);
        });

        if (years.length > 0) {
            await loadYearlyReport(parseInt(years[0]));
        }
    } catch (err) {
        console.error('初始化年份选择失败:', err);
        showToast('加载失败', 'error');
    }
}

async function loadYearlyReport(year) {
    try {
        showToast('正在加载年度数据...', 'info');

        const timeList = await fetchData('./data/time.json');

        const yearMonths = timeList.filter(m => m.startsWith(year.toString()));

        if (yearMonths.length === 0) {
            showToast('暂无该年数据', 'error');
            return;
        }

        const allData = [];
        for (const month of yearMonths) {
            try {
                const monthData = await fetchData(`./data/${month}.json`);
                allData.push(...monthData.map(d => ({ ...d, month })));
            } catch (e) {
                console.warn(`加载 ${month} 数据失败`);
            }
        }

        if (allData.length === 0) {
            showToast('暂无数据', 'error');
            return;
        }

        calculateYearlyStats(allData, year);

        renderDailyChart();
        renderMonthlyChart();
        renderHeatmapChart(year);

        setTimeout(() => {
            if (chartDaily) chartDaily.resize();
            if (chartMonthly) chartMonthly.resize();
            if (chartHeatmap) chartHeatmap.resize();
        }, 100);

        showToast('年度报告加载完成', 'success');
    } catch (err) {
        console.error('加载年度报告失败:', err);
        showToast('加载失败', 'error');
    }
}

function calculateYearlyStats(data, year) {
    const dailyConsumption = {};

    function parseDateStr(record) {
        const yearPart = record.month.split('-')[0]; // 年份部分
        const timePart = record.time.split(' ')[0]; // 空格前的日期部分

        const parts = timePart.split('-');
        if (parts.length >= 2) {
            const month = parts[0].padStart(2, '0');
            const day = parts[1].padStart(2, '0');
            return `${yearPart}-${month}-${day}`;
        }
        return `${yearPart}-${timePart}`;
    }

    function parseTimestamp(record) {
        const yearPart = record.month.split('-')[0];
        const timePart = record.time;
        const parts = timePart.split(' ');
        const datePart = parts[0].split('-');
        const month = datePart[0].padStart(2, '0');
        const day = datePart[1].padStart(2, '0');
        const time = parts[1] || '00:00';
        return new Date(`${yearPart}-${month}-${day}T${time}`);
    }

    const recordsByDate = {};
    data.forEach(record => {
        const dateStr = parseDateStr(record);
        if (!recordsByDate[dateStr]) {
            recordsByDate[dateStr] = [];
        }
        recordsByDate[dateStr].push(record);
    });

    const sortedDates = Object.keys(recordsByDate)
        .filter(dateStr => dateStr.startsWith(year.toString()))
        .sort();

    sortedDates.forEach((dateStr, index) => {
        const dayRecords = recordsByDate[dateStr].slice().sort((a, b) => parseTimestamp(a) - parseTimestamp(b));
        if (dayRecords.length === 0) return;

        // 当日内：累加每一次正向下降。充值是正跳变，max(0,…) 会自动剔除，
        // 而充值前已发生的消耗会被前面的区间正确计入（不会被一次充值抹平整天）。
        let lightConsumption = 0;
        let acConsumption = 0;
        for (let i = 1; i < dayRecords.length; i++) {
            lightConsumption += Math.max(0, (dayRecords[i - 1].light_Balance || 0) - (dayRecords[i].light_Balance || 0));
            acConsumption += Math.max(0, (dayRecords[i - 1].ac_Balance || 0) - (dayRecords[i].ac_Balance || 0));
        }

        // 隔夜：当日末读 → 次日首读（仅当两个日期连续时计入），同样只取下降部分。
        if (index < sortedDates.length - 1) {
            const nextDayRecords = recordsByDate[sortedDates[index + 1]];
            const dayDiff = (new Date(sortedDates[index + 1]) - new Date(dateStr)) / CONSTANTS.TIME.ONE_DAY_MS;
            if (nextDayRecords && nextDayRecords.length > 0 && dayDiff <= CONSTANTS.TIME.CONTINUOUS_DAY_THRESHOLD) {
                const lastRecord = dayRecords[dayRecords.length - 1];
                const nextDayFirst = nextDayRecords.slice().sort((a, b) => parseTimestamp(a) - parseTimestamp(b))[0];
                lightConsumption += Math.max(0, (lastRecord.light_Balance || 0) - (nextDayFirst.light_Balance || 0));
                acConsumption += Math.max(0, (lastRecord.ac_Balance || 0) - (nextDayFirst.ac_Balance || 0));
            }
        }

        dailyConsumption[dateStr] = {
            light: lightConsumption,
            ac: acConsumption
        };
    });

    const totals = Object.entries(dailyConsumption).reduce((acc, [date, consumption]) => {
        acc.totalLight += consumption.light;
        acc.totalAc += consumption.ac;

        const dayTotal = consumption.light + consumption.ac;
        if (dayTotal > acc.peakValue) {
            acc.peakValue = dayTotal;
            acc.peakDay = date;
        }
        return acc;
    }, { totalLight: 0, totalAc: 0, peakDay: '', peakValue: 0 });

    const { totalLight, totalAc, peakDay, peakValue } = totals;

    // 在首尾数据日期之间为缺失日期插值填充（仅供热力图/折线连续展示，
    // 不影响上面基于真实数据计算的总额与峰值）。
    const existingDates = Object.keys(dailyConsumption).sort();
    if (existingDates.length > 1) {
        const startDate = new Date(existingDates[0]);
        const endDate = new Date(existingDates[existingDates.length - 1]);

        const allDatesInRange = [];
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            allDatesInRange.push(d.toISOString().split('T')[0]);
        }

        const existingConsumptions = Object.values(dailyConsumption);
        const avgLightConsumption = existingConsumptions.length > 0
            ? existingConsumptions.reduce((sum, d) => sum + d.light, 0) / existingConsumptions.length
            : 0;
        const avgAcConsumption = existingConsumptions.length > 0
            ? existingConsumptions.reduce((sum, d) => sum + d.ac, 0) / existingConsumptions.length
            : 0;

        allDatesInRange.forEach(dateStr => {
            if (dailyConsumption[dateStr]) return;

            let prevData = null;
            let nextData = null;
            for (let i = existingDates.length - 1; i >= 0; i--) {
                if (existingDates[i] < dateStr) {
                    prevData = dailyConsumption[existingDates[i]];
                    break;
                }
            }
            for (let i = 0; i < existingDates.length; i++) {
                if (existingDates[i] > dateStr) {
                    nextData = dailyConsumption[existingDates[i]];
                    break;
                }
            }

            let lightValue;
            let acValue;
            if (prevData && nextData) {
                lightValue = Math.min((prevData.light + nextData.light) / 2, avgLightConsumption * 2);
                acValue = Math.min((prevData.ac + nextData.ac) / 2, avgAcConsumption * 2);
            } else if (prevData) {
                lightValue = Math.min(prevData.light, avgLightConsumption * 2);
                acValue = Math.min(prevData.ac, avgAcConsumption * 2);
            } else if (nextData) {
                lightValue = Math.min(nextData.light, avgLightConsumption * 2);
                acValue = Math.min(nextData.ac, avgAcConsumption * 2);
            } else {
                lightValue = avgLightConsumption;
                acValue = avgAcConsumption;
            }

            dailyConsumption[dateStr] = {
                light: MathUtils.clamp(lightValue, 0, CONSTANTS.ELECTRICITY.MAX_DAILY_CONSUMPTION),
                ac: MathUtils.clamp(acValue, 0, CONSTANTS.ELECTRICITY.MAX_DAILY_CONSUMPTION)
            };
        });
    }

    const total = totalLight + totalAc;
    const lightPercent = total > 0 ? ((totalLight / total) * 100).toFixed(1) : 0;
    const acPercent = total > 0 ? ((totalAc / total) * 100).toFixed(1) : 0;

    document.getElementById('report-total').textContent = total.toFixed(2) + ' 度';
    document.getElementById('report-total-year').textContent = `${year} 年`;
    document.getElementById('report-light-total').textContent = totalLight.toFixed(2) + ' 度';
    document.getElementById('report-light-percent').textContent = `占比 ${lightPercent}%`;
    document.getElementById('report-ac-total').textContent = totalAc.toFixed(2) + ' 度';
    document.getElementById('report-ac-percent').textContent = `占比 ${acPercent}%`;
    document.getElementById('report-peak').textContent = peakValue.toFixed(2) + ' 度';
    document.getElementById('report-peak-date').textContent = peakDay;

    const dates = Object.keys(dailyConsumption).sort();
    if (dates.length > 0) {
        document.getElementById('report-date-range').textContent =
            `数据范围：${dates[0]} 至 ${dates[dates.length - 1]}`;
    }

    yearlyData = { dailyConsumption, totalLight, totalAc };
}

function renderDailyChart() {
    if (!chartDaily) {
        chartDaily = echarts.init(document.getElementById('chart-daily'));
    }

    const colors = getChartColors();
    const dailyData = yearlyData.dailyConsumption;

    const dates = Object.keys(dailyData).sort();
    const lightData = dates.map(d => dailyData[d].light.toFixed(2));
    const acData = dates.map(d => dailyData[d].ac.toFixed(2));

    const option = {
        tooltip: {
            trigger: 'axis',
            backgroundColor: colors.cardBg,
            borderColor: colors.border,
            textStyle: { color: colors.text }
        },
        legend: {
            data: ['照明', '空调'],
            textStyle: { color: colors.textSecondary },
            top: 0
        },
        grid: {
            left: '3%', right: '4%', bottom: '15%', top: '12%',
            containLabel: true
        },
        xAxis: {
            type: 'category',
            data: dates,
            axisLine: { lineStyle: { color: colors.border } },
            axisLabel: {
                color: colors.textSecondary,
                fontSize: 10,
                rotate: 45,
                formatter: v => v.substring(5)
            }
        },
        yAxis: {
            type: 'value',
            name: '用量 (度)',
            axisLine: { show: false },
            axisLabel: { color: colors.textSecondary },
            splitLine: { lineStyle: { color: colors.border, type: 'dashed' } }
        },
        series: [
            {
                name: '照明',
                type: 'line',
                smooth: true,
                symbol: 'none',
                data: lightData,
                lineStyle: { color: '#3b82f6', width: 2 },
                areaStyle: {
                    color: {
                        type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                        colorStops: [
                            { offset: 0, color: 'rgba(59, 130, 246, 0.3)' },
                            { offset: 1, color: 'rgba(59, 130, 246, 0.05)' }
                        ]
                    }
                }
            },
            {
                name: '空调',
                type: 'line',
                smooth: true,
                symbol: 'none',
                data: acData,
                lineStyle: { color: '#10b981', width: 2 },
                areaStyle: {
                    color: {
                        type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                        colorStops: [
                            { offset: 0, color: 'rgba(16, 185, 129, 0.3)' },
                            { offset: 1, color: 'rgba(16, 185, 129, 0.05)' }
                        ]
                    }
                }
            }
        ],
        dataZoom: [
            { type: 'slider', height: 20, bottom: 5 },
            { type: 'inside' }
        ]
    };

    chartDaily.setOption(option);
}

function renderMonthlyChart() {
    if (!chartMonthly) {
        chartMonthly = echarts.init(document.getElementById('chart-monthly'));
    }

    const colors = getChartColors();
    const dailyData = yearlyData.dailyConsumption;

    const monthlyStats = {};
    Object.entries(dailyData).forEach(([date, consumption]) => {
        const month = date.substring(0, 7);
        if (!monthlyStats[month]) {
            monthlyStats[month] = { light: 0, ac: 0 };
        }
        monthlyStats[month].light += consumption.light;
        monthlyStats[month].ac += consumption.ac;
    });

    const months = Object.keys(monthlyStats).sort();
    const lightData = months.map(m => monthlyStats[m].light.toFixed(1));
    const acData = months.map(m => monthlyStats[m].ac.toFixed(1));

    const option = {
        tooltip: {
            trigger: 'axis',
            backgroundColor: colors.cardBg,
            borderColor: colors.border,
            textStyle: { color: colors.text },
            formatter: params => {
                let result = `<div style="font-weight:600">${params[0].name}</div>`;
                params.forEach(p => {
                    result += `<div>${p.marker} ${p.seriesName}: ${p.value} 度</div>`;
                });
                const total = params.reduce((sum, p) => sum + parseFloat(p.value), 0);
                result += `<div style="margin-top:4px;font-weight:600">合计: ${total.toFixed(1)} 度</div>`;
                return result;
            }
        },
        legend: {
            data: ['照明', '空调'],
            textStyle: { color: colors.textSecondary },
            top: 0
        },
        grid: {
            left: '3%', right: '4%', bottom: '8%', top: '15%',
            containLabel: true
        },
        xAxis: {
            type: 'category',
            data: months.map(m => m.substring(5) + '月'),
            axisLine: { lineStyle: { color: colors.border } },
            axisLabel: { color: colors.textSecondary }
        },
        yAxis: {
            type: 'value',
            name: '用电量 (度)',
            axisLine: { show: false },
            axisLabel: { color: colors.textSecondary },
            splitLine: { lineStyle: { color: colors.border, type: 'dashed' } }
        },
        series: [
            {
                name: '照明',
                type: 'bar',
                stack: 'total',
                data: lightData,
                itemStyle: {
                    color: '#3b82f6',
                    borderRadius: [0, 0, 0, 0]
                }
            },
            {
                name: '空调',
                type: 'bar',
                stack: 'total',
                data: acData,
                itemStyle: {
                    color: '#10b981',
                    borderRadius: [4, 4, 0, 0]
                }
            }
        ]
    };

    chartMonthly.setOption(option);
}

function renderHeatmapChart(year) {
    if (!chartHeatmap) {
        chartHeatmap = echarts.init(document.getElementById('chart-heatmap'));
    }

    const colors = getChartColors();
    const dailyData = yearlyData.dailyConsumption;

    if (!dailyData || Object.keys(dailyData).length === 0) {
        console.warn('热力图: 无数据');
        return;
    }

    const heatmapData = [];
    let maxValue = 0;
    Object.entries(dailyData).forEach(([date, consumption]) => {
        const total = consumption.light + consumption.ac;
        const value = parseFloat(total.toFixed(2));
        heatmapData.push([date, value]);
        if (value > maxValue) maxValue = value;
    });

    const visualMapMax = Math.max(10, Math.ceil(maxValue / 10) * 10);

    const option = {
        tooltip: {
            formatter: params => {
                return `${params.value[0]}<br/>用电量: ${params.value[1]} 度`;
            }
        },
        calendar: {
            top: 120,
            left: 40,
            right: 40,
            cellSize: ['auto', 20],
            range: year.toString(),
            itemStyle: {
                borderWidth: 2,
                borderColor: colors.cardBg
            },
            yearLabel: { show: false },
            dayLabel: {
                color: colors.textSecondary,
                nameMap: 'ZH'
            },
            monthLabel: {
                color: colors.textSecondary,
                nameMap: 'ZH'
            },
            splitLine: {
                lineStyle: { color: colors.border }
            }
        },
        visualMap: {
            min: 0,
            max: visualMapMax,
            calculable: true,
            orient: 'horizontal',
            left: 'center',
            top: 0,
            inRange: {
                color: ['#e8f5e9', '#c8e6c9', '#a5d6a7', '#81c784', '#66bb6a', '#4caf50', '#43a047', '#388e3c', '#2e7d32', '#1b5e20']
            },
            textStyle: { color: colors.textSecondary }
        },
        series: [{
            type: 'heatmap',
            coordinateSystem: 'calendar',
            data: heatmapData
        }]
    };

    chartHeatmap.setOption(option);
}

exportBtn.addEventListener('click', async () => {
    showToast('正在生成图片...', 'info');

    const reportContent = document.getElementById('report-content');
    const yearSelect = document.getElementById('report-year-select');
    const titleElement = document.querySelector('.report-header h2');
    const originalTitle = titleElement.textContent;
    const currentYear = yearSelect.value;

    try {
        if (typeof modernScreenshot === 'undefined') {
            await loadScript('https://cdn.jsdelivr.net/npm/modern-screenshot/dist/index.js');
        }

        reportModal.classList.add('is-exporting');

        titleElement.textContent = `⚡ ${currentYear} 宿舍用电年度总结`;

        const dataUrl = await modernScreenshot.domToPng(reportContent, {
            scale: 2,
            backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim(),
            style: {
                transform: 'scale(1)',
                transformOrigin: 'top left'
            },
            filter: (node) => {
                return !node.classList || (!node.classList.contains('modal-close') && !node.classList.contains('btn-export'));
            }
        });

        const link = document.createElement('a');
        link.download = `电量年度总结_${currentYear}.png`;
        link.href = dataUrl;
        link.click();

        showToast('图片已保存', 'success');
    } catch (err) {
        console.error('导出失败:', err);
        showToast('导出失败', 'error');
    } finally {
        titleElement.textContent = originalTitle;
        reportModal.classList.remove('is-exporting');
    }
});

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const existingScript = document.querySelector(`script[src="${src}"]`);
        if (existingScript) {
            if (existingScript.dataset.loaded === 'true') {
                resolve();
                return;
            }
            existingScript.addEventListener('load', resolve, { once: true });
            existingScript.addEventListener('error', reject, { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.onload = () => {
            script.dataset.loaded = 'true';
            resolve();
        };
        script.onerror = () => {
            script.remove();
            reject();
        };
        document.head.appendChild(script);
    });
}

window.addEventListener('resize', () => {
    chartLight.resize();
    chartAc.resize();
    if (chartDaily) chartDaily.resize();
    if (chartMonthly) chartMonthly.resize();
    if (chartHeatmap) chartHeatmap.resize();
});


document.addEventListener('DOMContentLoaded', function() {
    const roomFinderBtn = document.getElementById('room-query-btn');
    const roomQueryModal = document.getElementById('room-query-modal');
    const roomModalClose = document.getElementById('room-modal-close');
    const roomModalOverlay = roomQueryModal?.querySelector('.modal-overlay');

    function openRoomModal() {
        roomQueryModal.classList.add('show');
        document.body.classList.add('modal-open');
    }

    function closeRoomModal() {
        roomQueryModal.classList.remove('show');
        document.body.classList.remove('modal-open');
    }

    if (roomFinderBtn && roomQueryModal) {
        roomFinderBtn.addEventListener('click', openRoomModal);
    }

    if (roomModalClose && roomQueryModal) {
        roomModalClose.addEventListener('click', closeRoomModal);
    }

    if (roomModalOverlay) {
        roomModalOverlay.addEventListener('click', closeRoomModal);
    }

    if (roomQueryModal) {
        roomQueryModal.addEventListener('click', (e) => {
            if (e.target === roomQueryModal) {
                closeRoomModal();
            }
        });
    }

    const areaSelect = document.getElementById('area-select');
    const buildingSelect = document.getElementById('building-select');
    const unitSelect = document.getElementById('unit-select');
    const roomSelect = document.getElementById('room-select');
    const lightRoomResult = document.getElementById('light-room-result');
    const acRoomResult = document.getElementById('ac-room-result');
    const copyLightBtn = document.getElementById('copy-light-btn');
    const copyAcBtn = document.getElementById('copy-ac-btn');

    let currentLightRoomId = '';
    let currentAcRoomId = '';
    const roomDataCache = new Map();
    const gardenOrder = ['柳园', '荷园', '菊园', '松园'];

    function sortByFirstNumber(a, b) {
        const numA = parseInt((a.match(/\d+/) || [0])[0], 10);
        const numB = parseInt((b.match(/\d+/) || [0])[0], 10);
        return numA === numB ? a.localeCompare(b) : numA - numB;
    }

    function sortBuildingNames(names) {
        return names.sort((a, b) => {
            const gardenA = gardenOrder.find(garden => a.startsWith(garden)) || '';
            const gardenB = gardenOrder.find(garden => b.startsWith(garden)) || '';
            const gardenDiff = gardenOrder.indexOf(gardenA) - gardenOrder.indexOf(gardenB);
            return gardenDiff || sortByFirstNumber(a, b);
        });
    }

    function setSelectOptions(select, placeholder, values = []) {
        select.innerHTML = `<option value="">${placeholder}</option>`;
        values.forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            select.appendChild(option);
        });
    }

    function getBuilding(areaData, buildingName) {
        return areaData?.buildings?.[buildingName] || null;
    }

    function findRoomUnit(units, keyword) {
        const matched = Object.entries(units).find(([name]) => name.includes(keyword));
        return matched ? matched[1] : units['房间用电'] || null;
    }

    function isLikelyPairedRoom(sourceRoom, targetRoom) {
        const source = String(sourceRoom || '');
        const target = String(targetRoom || '');
        if (!source || !target) return false;
        if (source === target) return true;

        const shorter = source.length <= target.length ? source : target;
        const longer = source.length > target.length ? source : target;
        return shorter.length >= 3 && longer.endsWith(shorter);
    }

    function getRoomId(unit, roomNumber, fallbackIndex = -1) {
        if (!unit?.rooms || !unit?.ids) return '';
        const directIndex = unit.rooms.indexOf(roomNumber);
        const fallbackRoom = unit.rooms[fallbackIndex];
        const roomIndex = directIndex !== -1
            ? directIndex
            : isLikelyPairedRoom(roomNumber, fallbackRoom)
                ? fallbackIndex
                : -1;
        return roomIndex >= 0 ? unit.ids[roomIndex] || '' : '';
    }

    function setRoomResult(resultEl, copyBtn, roomId, missingText) {
        resultEl.textContent = roomId || missingText;
        copyBtn.disabled = !roomId;
        return roomId || '';
    }

    async function loadRoomData(areaId) {
        if (!areaId) return null;
        if (roomDataCache.has(areaId)) {
            return roomDataCache.get(areaId);
        }

        const dataPromise = fetch(`./data/rooms/${areaId}.json`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to load room data for area ${areaId}: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (!data || !data.buildings || typeof data.buildings !== 'object') {
                    throw new Error(`Invalid room data for area ${areaId}`);
                }
                roomDataCache.set(areaId, data);
                return data;
            })
            .catch(error => {
                roomDataCache.delete(areaId);
                throw error;
            });
        roomDataCache.set(areaId, dataPromise);
        return dataPromise;
    }

    if (areaSelect) {
        areaSelect.addEventListener('change', async function() {
            const areaId = this.value;

            setSelectOptions(buildingSelect, '请选择建筑');
            setSelectOptions(unitSelect, '请选择单元');
            setSelectOptions(roomSelect, '请选择房间');
            buildingSelect.disabled = !areaId;
            unitSelect.disabled = true;
            roomSelect.disabled = true;

            clearResults();

            if (areaId) {
                buildingSelect.disabled = true;
                buildingSelect.innerHTML = '<option value="">正在加载建筑...</option>';
            }

            try {
                const areaData = await loadRoomData(areaId);
                if (areaSelect.value !== areaId) return;
                if (!areaData) {
                    setSelectOptions(buildingSelect, '请选择建筑');
                    buildingSelect.disabled = true;
                    return;
                }

                const buildings = areaData.buildings;
                setSelectOptions(buildingSelect, '请选择建筑', sortBuildingNames(Object.keys(buildings)));
                buildingSelect.disabled = false;
            } catch (error) {
                if (areaSelect.value !== areaId) return;
                console.error('房间数据加载失败:', error);
                buildingSelect.innerHTML = '<option value="">房间数据加载失败</option>';
                buildingSelect.disabled = true;
                setSelectOptions(unitSelect, '请选择单元');
                unitSelect.disabled = true;
                setSelectOptions(roomSelect, '请选择房间');
                roomSelect.disabled = true;
                showToast('房间数据加载失败，请稍后重试', 'error');
            }
        });
    }

    if (buildingSelect) {
        buildingSelect.addEventListener('change', function() {
            const areaId = areaSelect.value;
            const buildingName = this.value;
            const areaData = roomDataCache.get(areaId);

            setSelectOptions(unitSelect, '请选择单元');
            setSelectOptions(roomSelect, '请选择房间');
            unitSelect.disabled = !buildingName;
            roomSelect.disabled = true;

            clearResults();

            const building = getBuilding(areaData, buildingName);
            if (building?.units) {
                setSelectOptions(unitSelect, '请选择单元', Object.keys(building.units).sort(sortByFirstNumber));
            }
        });
    }

    if (unitSelect) {
        unitSelect.addEventListener('change', function() {
            const areaId = areaSelect.value;
            const buildingName = buildingSelect.value;
            const unitName = this.value;
            const areaData = roomDataCache.get(areaId);

            setSelectOptions(roomSelect, '请选择房间');
            roomSelect.disabled = !unitName;

            clearResults();

            const unit = getBuilding(areaData, buildingName)?.units?.[unitName];
            if (unit?.rooms) {
                setSelectOptions(roomSelect, '请选择房间', unit.rooms.slice().sort(sortByFirstNumber));
            }
        });
    }

    if (roomSelect) {
        roomSelect.addEventListener('change', function() {
            const areaId = areaSelect.value;
            const buildingName = buildingSelect.value;
            const unitName = unitSelect.value;
            const roomNumber = this.value;
            const areaData = roomDataCache.get(areaId);
            const building = getBuilding(areaData, buildingName);
            const units = building?.units;
            const selectedUnit = units?.[unitName];
            const selectedIndex = selectedUnit?.rooms?.indexOf(roomNumber) ?? -1;

            if (!units || !selectedUnit || selectedIndex === -1) {
                clearResults();
                return;
            }

            if (areaId === '105') {
                const roomId = getRoomId(selectedUnit, roomNumber, selectedIndex);
                currentLightRoomId = setRoomResult(lightRoomResult, copyLightBtn, roomId, '该房间无照明编号');
                currentAcRoomId = setRoomResult(acRoomResult, copyAcBtn, roomId, '该房间无空调编号');
                return;
            }

            currentLightRoomId = setRoomResult(
                lightRoomResult,
                copyLightBtn,
                getRoomId(findRoomUnit(units, '照明'), roomNumber, selectedIndex),
                '该房间无照明编号'
            );
            currentAcRoomId = setRoomResult(
                acRoomResult,
                copyAcBtn,
                getRoomId(findRoomUnit(units, '空调'), roomNumber, selectedIndex),
                '该房间无空调编号'
            );
        });
    }

    if (copyLightBtn) {
        copyLightBtn.addEventListener('click', function() {
            if (currentLightRoomId) {
                copyToClipboard(currentLightRoomId, '照明房间编号已复制');
            }
        });
    }

    if (copyAcBtn) {
        copyAcBtn.addEventListener('click', function() {
            if (currentAcRoomId) {
                copyToClipboard(currentAcRoomId, '空调房间编号已复制');
            }
        });
    }

    function clearResults() {
        lightRoomResult.textContent = '请先选择房间';
        acRoomResult.textContent = '请先选择房间';
        copyLightBtn.disabled = true;
        copyAcBtn.disabled = true;
        currentLightRoomId = '';
        currentAcRoomId = '';
    }

    function copyToClipboard(text, successMessage) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => {
                showToast(successMessage, 'success');
            }).catch(err => {
                console.error('复制失败:', err);
                fallbackCopyTextToClipboard(text, successMessage);
            });
        } else {
            fallbackCopyTextToClipboard(text, successMessage);
        }
    }

    function fallbackCopyTextToClipboard(text, successMessage) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.className = 'clipboard-buffer';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            const successful = document.execCommand('copy');
            if (successful) {
                showToast(successMessage, 'success');
            } else {
                showToast('复制失败，请手动复制', 'error');
            }
        } catch (err) {
            console.error('复制失败:', err);
            showToast('复制失败，请手动复制', 'error');
        }

        document.body.removeChild(textArea);
    }
});
