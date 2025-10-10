import logging
import os
import json
import smtplib
import asyncio
from datetime import datetime
from email.mime.text import MIMEText
from glob import glob
from os import makedirs, path
from typing import List, Dict, Optional, Union

import pytz
import requests
from tenacity import (
    retry, 
    stop_after_attempt, 
    wait_exponential,
    wait_chain,
    wait_fixed,
    retry_if_exception_type
)
from zzupy import ZZUPy

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 常量定义
THRESHOLD = 10.0
EXCELLENT_THRESHOLD = 100.0
JSON_FOLDER_PATH = "./page/data"

# 重试配置常量
RETRY_ATTEMPTS = 5
RETRY_MULTIPLIER = 1
INITIAL_WAIT = 15
MAX_WAIT = 120

# 环境变量
ACCOUNT = os.getenv("ACCOUNT")
PASSWORD = os.getenv("PASSWORD")
LT_ROOM = os.getenv("lt_room")
AC_ROOM = os.getenv("ac_room")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
SERVERCHAN_KEYS = os.getenv("SERVERCHAN_KEYS")
EMAIL = os.getenv("EMAIL")
SMTP_CODE = os.getenv("SMTP_CODE")
SMTP_SERVER = os.getenv("SMTP_SERVER")

# 通用重试装饰器
def create_retry_decorator(stop_attempts=RETRY_ATTEMPTS, wait_strategy=None):
    """创建统一的重试装饰器"""
    if wait_strategy is None:
        wait_strategy = wait_exponential(
            multiplier=RETRY_MULTIPLIER, 
            min=INITIAL_WAIT, 
            max=MAX_WAIT
        )
    
    return retry(
        stop=stop_after_attempt(stop_attempts),
        wait=wait_strategy,
        retry=retry_if_exception_type(Exception),
        reraise=True
    )

# 通用的请求重试装饰器
request_retry = create_retry_decorator(
    wait_strategy=wait_chain(
        wait_fixed(15),  # 第一次等待15s
        wait_fixed(30),  # 第二次等待30s
        wait_exponential(multiplier=1, min=45, max=120)  # 后续按指数退避
    )
)

class EnergyMonitor:
    """电量监控器，负责获取电量信息"""
    
    def __init__(self):
        self.zzupy = ZZUPy(ACCOUNT, PASSWORD)
        self.get_energy_balance = create_retry_decorator()(self._get_energy_balance)

    async def _get_energy_balance(self) -> Dict[str, float]:
        """使用 ZZUPy 库获取电量余额（实际实现）"""
        logger.info("尝试登录 ZZUPy 系统...")
        await self.zzupy.login()
        logger.info("登录成功")
        
        logger.info("获取照明和空调电量余额...")
        lt_balance = await self.zzupy.get_remaining_energy(LT_ROOM)
        ac_balance = await self.zzupy.get_remaining_energy(AC_ROOM)
        
        logger.info(f"照明剩余电量：{lt_balance} 度，空调剩余电量：{ac_balance} 度")
        
        await self.zzupy.logout()
        logger.info("已登出 ZZUPy 系统")

        return {"lt_Balance": lt_balance, "ac_Balance": ac_balance}


class NotificationManager:
    """通知管理器，负责发送各种通知"""
    
    @staticmethod
    def format_balance_report(lt_balance: float, ac_balance: float, escape_dot: bool = False) -> str:
        """格式化电量报告信息"""
        def get_status(balance: float) -> str:
            if balance > EXCELLENT_THRESHOLD:
                return "充足"
            elif balance > THRESHOLD:
                return "还行"
            else:
                return "⚠️警告"

        lt_status = get_status(lt_balance)
        ac_status = get_status(ac_balance)

        # 根据 escape_dot 参数决定是否转义 '.'
        lt_balance_str = str(lt_balance).replace(".", "\\.") if escape_dot else str(lt_balance)
        ac_balance_str = str(ac_balance).replace(".", "\\.") if escape_dot else str(ac_balance)

        return (
            f"💡 照明剩余电量：{lt_balance_str} 度（{lt_status}）\n"
            f"❄️ 空调剩余电量：{ac_balance_str} 度（{ac_status}）\n\n"
        )

    @staticmethod
    def is_low_energy(balances: Dict[str, float]) -> bool:
        """判断是否低电量"""
        return balances['lt_Balance'] <= THRESHOLD or balances['ac_Balance'] <= THRESHOLD

    @staticmethod
    @request_retry
    def send_serverchan_notification(title: str, content: str) -> None:
        """发送 Server 酱通知（带重试）"""
        if not SERVERCHAN_KEYS:
            logger.info("未配置 SERVERCHAN_KEYS，跳过 Server 酱通知")
            return
            
        logger.info("通过 Server 酱发送通知...")
        for key in SERVERCHAN_KEYS.split(','):
            key = key.strip()
            if not key:
                continue
                
            url = f"https://sctapi.ftqq.com/{key}.send"
            payload = {"title": title, "desp": content}
            
            response = requests.post(url, data=payload, timeout=10)
            try:
                result = response.json()
            except ValueError:
                logger.error("Server酱返回非 JSON，返回文本：%s", response.text)
                continue

            if result.get("code") == 0:
                logger.info(f"Server 酱通知发送成功，使用的密钥：{key}")
            else:
                logger.error(f"Server 酱通知发送失败，错误信息：{result.get('message')}")

    @staticmethod
    @create_retry_decorator()
    def send_email_notification(title: str, content: str) -> None:
        """发送邮件通知（带重试）"""
        if not all([EMAIL, SMTP_CODE, SMTP_SERVER]):
            logger.info("邮件配置不完整，跳过邮件通知")
            return
            
        logger.info("通过邮件发送通知...")
        
        msg = MIMEText(content, "plain", "utf-8")
        msg["Subject"] = title
        msg["From"] = EMAIL
        msg["To"] = EMAIL

        try:
            smtp = smtplib.SMTP_SSL(SMTP_SERVER, 465)
            smtp.login(EMAIL, SMTP_CODE)
            smtp.send_message(msg)
            smtp.quit()
            logger.info("邮件通知发送成功")
        except Exception as e:
            logger.error(f"邮件通知发送失败：{e}")
            raise


async def main():
    """主函数：负责协调电量获取与通知逻辑"""
    energy_monitor = EnergyMonitor()
    notification_manager = NotificationManager()

    balances = await energy_monitor.get_energy_balance()

    content = notification_manager.format_balance_report(
        balances["lt_Balance"], 
        balances["ac_Balance"]
    )

    logger.info("\n" + content)

    # 检查是否低电量
    if notification_manager.is_low_energy(balances):
        title = "⚠️ 郑州大学宿舍电量警告"
        logger.warning("检测到低电量，发送警告通知...")
        notification_manager.send_serverchan_notification(title, content)
        notification_manager.send_email_notification(title, content)
    else:
        title = "✅ 郑州大学宿舍电量正常"
        logger.info("电量正常，发送日报通知...")
        notification_manager.send_serverchan_notification(title, content)


if __name__ == "__main__":
    asyncio.run(main())